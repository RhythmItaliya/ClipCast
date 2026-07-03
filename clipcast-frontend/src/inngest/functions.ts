import { env } from "~/env";
import { inngest } from "./client";
import { db } from "~/server/db";
import {
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";

// ── Video Processing ────────────────────────────────────────────────────────
export const processVideoFn = inngest.createFunction(
  {
    id: "process-video",
    retries: 1,
    concurrency: {
      limit: 1,
      key: "event.data.userId",
    },
    cancelOn: [
      {
        event: "cancel-job-events",
        match: "data.uploadedFileId",
      },
    ],
    onFailure: async ({ event }) => {
      const originalEvent = event.data.event as {
        data: { uploadedFileId?: string };
      };
      const uploadedFileId = originalEvent?.data?.uploadedFileId;
      if (uploadedFileId) {
        await db.uploadedFile.update({
          where: { id: uploadedFileId },
          data: { status: "failed" },
        });
      }
    },
  },
  { event: "process-video-events" },
  async ({ event, step }) => {
    const { uploadedFileId } = event.data as {
      uploadedFileId: string;
      userId: string;
      youtubeUrl?: string;
      clipMode?: string;
      previewOnly?: boolean;
    };
    const youtubeUrl = (event.data as { youtubeUrl?: string }).youtubeUrl;
    const clipMode = (event.data as { clipMode?: string }).clipMode ?? "qa";
    const previewOnly =
      (event.data as { previewOnly?: boolean }).previewOnly ?? false;

    try {
      const { userId, credits, s3Key } = await step.run(
        "check-credits",
        async () => {
          const uploadedFile = await db.uploadedFile.findUniqueOrThrow({
            where: { id: uploadedFileId },
            select: {
              user: { select: { id: true, credits: true } },
              s3Key: true,
            },
          });
          return {
            userId: uploadedFile.user.id,
            credits: uploadedFile.user.credits,
            s3Key: uploadedFile.s3Key,
          };
        },
      );

      let durationSeconds = 0;
      await step.run("get-video-duration", async () => {
        // No local yt-dlp here: for YouTube jobs the real duration is measured
        // on the Modal worker after it downloads the video (exact credits are
        // deducted afterwards). For direct uploads we fall back to any stored
        // duration (default 5 mins) purely for the up-front credit gate.
        try {
          const file = await db.uploadedFile.findUnique({
            where: { id: uploadedFileId },
          });
          if (youtubeUrl) {
            durationSeconds = file?.duration ?? 0;
          } else {
            durationSeconds = file?.duration ?? 300;
            await db.uploadedFile.update({
              where: { id: uploadedFileId },
              data: { duration: Math.round(durationSeconds) },
            });
          }
        } catch (e) {
          console.warn("Could not determine duration", e);
          durationSeconds = youtubeUrl ? 0 : 300;
        }
      });

      // For YouTube jobs the up-front duration is unknown (downloaded on Modal),
      // so require at least 1 credit to start; the exact amount is deducted once
      // Modal returns the real duration.
      const requiredCredits = youtubeUrl
        ? Math.max(1, Math.ceil(durationSeconds / 60))
        : Math.ceil(durationSeconds / 60);

      if (credits >= requiredCredits) {
        await step.run("set-status-processing", async () => {
          await db.uploadedFile.update({
            where: { id: uploadedFileId },
            data: { status: "processing" },
          });
        });

        // YouTube sources first pass through a CPU-only Modal downloader and
        // land in S3. The GPU worker then reads only from S3, so neither stage
        // consumes local CPU, RAM, GPU, disk, or bandwidth.

        if (youtubeUrl) {
          if (!env.DOWNLOAD_VIDEO_ENDPOINT) {
            throw new Error(
              "YTDLP_ERROR: DOWNLOAD_VIDEO_ENDPOINT is not configured.",
            );
          }

          const submitted = await step.run(
            "submit-youtube-download",
            async () =>
              postCloudDownloader({
                youtube_url: youtubeUrl,
                s3_key: s3Key,
              }),
          );

          const callId = submitted.data.call_id;
          if (submitted.httpStatus !== 202 || !callId) {
            throw new Error(
              `YTDLP_ERROR: Could not submit cloud download (${submitted.httpStatus}): ${submitted.body.slice(0, 800)}`,
            );
          }

          let downloadData: CloudDownloaderResponse | undefined;
          for (let attempt = 0; attempt < 120; attempt += 1) {
            await step.sleep(`wait-youtube-download-${attempt}`, "15s");

            const polled = await step.run(
              `poll-youtube-download-${attempt}`,
              async () => postCloudDownloader({ call_id: callId }),
            );

            if (polled.httpStatus === 202) continue;
            if (polled.httpStatus < 200 || polled.httpStatus >= 300) {
              throw new Error(
                `YTDLP_ERROR: Cloud download failed (${polled.httpStatus}): ${polled.body.slice(0, 800)}`,
              );
            }

            downloadData = polled.data;
            break;
          }

          if (!downloadData) {
            throw new Error(
              "YTDLP_ERROR: Cloud download did not finish within 30 minutes.",
            );
          }

          if (downloadData.duration && downloadData.duration > 0) {
            durationSeconds = downloadData.duration;
          }
        }

        const modalResponse = await step.fetch(env.PROCESS_VIDEO_ENDPOINT, {
          method: "POST",
          body: JSON.stringify({
            s3_key: s3Key,
            // YouTube has already been downloaded to S3 by the CPU-only Modal
            // function. The L40S worker performs GPU processing only.
            youtube_url: null,
            clip_mode: clipMode,
            preview_only: previewOnly,
          }),
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${env.PROCESS_VIDEO_ENDPOINT_AUTH}`,
          },
        });

        if (!modalResponse.ok) {
          const errText = await modalResponse.text().catch(() => "");
          throw new Error(
            `Modal endpoint returned ${modalResponse.status}: ${errText.slice(0, 300)}`,
          );
        }

        const modalData = (await modalResponse.json()) as { duration?: number };
        // Billing rule: 1 credit per minute of source video, rounded up, with a
        // minimum of 1 credit per processed video. Guard against a 0/empty
        // duration from Modal (which would otherwise deduct nothing).
        const exactDuration =
          modalData.duration && modalData.duration > 0
            ? modalData.duration
            : durationSeconds;
        const finalCreditsToDeduct = Math.max(1, Math.ceil(exactDuration / 60));

        await step.run("update-exact-duration", async () => {
          await db.uploadedFile.update({
            where: { id: uploadedFileId },
            data: { duration: Math.round(exactDuration) },
          });
        });

        await step.run("create-clips-in-db", async () => {
          const folderPrefix = s3Key.split("/")[0]!;
          const allKeys = await listS3ObjectsByPrefix(folderPrefix);
          const clipKeys = allKeys.filter(
            (key): key is string =>
              key !== undefined && !key.endsWith("original.mp4"),
          );

          if (clipKeys.length > 0) {
            await db.clip.createMany({
              data: clipKeys.map((clipKey) => ({
                s3Key: clipKey,
                uploadedFileId,
                userId,
                clipMode,
                isPreview: previewOnly || clipKey.includes("preview_"),
              })),
            });
          }
        });

        await step.run("deduct-credits", async () => {
          await db.user.update({
            where: { id: userId },
            data: {
              credits: { decrement: finalCreditsToDeduct },
            },
          });
        });

        await step.run("set-status-processed", async () => {
          await db.uploadedFile.update({
            where: { id: uploadedFileId },
            data: { status: "processed" },
          });
        });
      } else {
        await step.run("set-status-no-credits", async () => {
          await db.uploadedFile.update({
            where: { id: uploadedFileId },
            data: { status: "no credits" },
          });
        });
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `[inngest] processVideo failed for ${uploadedFileId}:`,
        message,
      );
      // Extract clean user-facing message for YTDLP errors
      const userMessage = message.startsWith("YTDLP_ERROR: ")
        ? message.slice("YTDLP_ERROR: ".length)
        : null;
      await db.uploadedFile.update({
        where: { id: uploadedFileId },
        data: {
          status: "failed",
          ...(userMessage ? { errorMessage: userMessage } : {}),
        },
      });
      throw error;
    }
  },
);

// ── Daily Clip Scheduler (CRON) ─────────────────────────────────────────────
// Runs every day at 09:00 UTC.
// For each user with a connected YouTube channel, fetches their latest video,
// queues it for processing (highlights mode), and — once ready — uploads one
// clip back to their channel via the YouTube Data API.
export const dailyClipScheduler = inngest.createFunction(
  {
    id: "daily-clip-scheduler",
    retries: 0,
  },
  { cron: "0 9 * * *" }, // 09:00 UTC every day
  async ({ step }) => {
    // 1. Get all users with a connected YouTube channel
    const connectedUsers = await step.run("get-connected-users", async () => {
      return await db.user.findMany({
        where: {
          youtubeChannelId: { not: null },
          youtubeAccessToken: { not: null },
          credits: { gt: 0 },
        },
        select: {
          id: true,
          email: true,
          youtubeChannelId: true,
          youtubeChannelName: true,
          credits: true,
        },
      });
    });

    console.log(
      `[cron] Found ${connectedUsers.length} users with YouTube channels`,
    );

    // 2. For each connected user, trigger video processing
    for (const user of connectedUsers) {
      await step.run(`queue-user-${user.id}`, async () => {
        // NOTE: Fetching latest video & uploading clips back to YouTube requires
        // YouTube Data API v3 with youtube.readonly + youtube.upload scopes.
        // Full implementation requires storing valid OAuth tokens per user.
        // The event is fired here; the upload step can be added once tokens are verified.
        console.log(
          `[cron] Queuing highlights processing for user ${user.email} ` +
            `(channel: ${user.youtubeChannelName ?? user.youtubeChannelId})`,
        );
        // Future: use YouTube API to get latest video URL, pass as youtubeUrl
        // await inngest.send({ name: "process-video-events", data: { ... } });
      });
    }

    return { processed: connectedUsers.length };
  },
);

// ── System Event Handlers ───────────────────────────────────────────────────
export const syncInngestCancellation = inngest.createFunction(
  { id: "sync-inngest-cancellation", retries: 0 },
  { event: "inngest/function.canceled" },
  async ({ event }) => {
    const originalEvent = event.data?.event as
      | { data?: { uploadedFileId?: string } }
      | undefined;
    const uploadedFileId = originalEvent?.data?.uploadedFileId;

    if (uploadedFileId) {
      console.log(
        `[inngest] Caught system cancellation for file ${uploadedFileId}. Syncing DB...`,
      );
      await db.uploadedFile.updateMany({
        where: { id: uploadedFileId, status: { in: ["queued", "processing"] } },
        data: { status: "cancelled" },
      });
    }
  },
);

// ── Helpers ─────────────────────────────────────────────────────────────────
async function listS3ObjectsByPrefix(prefix: string) {
  const s3Client = new S3Client({
    region: env.AWS_REGION,
    credentials: {
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    },
  });

  const listCommand = new ListObjectsV2Command({
    Bucket: env.S3_BUCKET_NAME,
    Prefix: prefix,
  });

  const response = await s3Client.send(listCommand);
  return response.Contents?.map((item) => item.Key).filter(Boolean) ?? [];
}

type CloudDownloaderResponse = {
  status?: string;
  call_id?: string;
  duration?: number;
  detail?: string;
};

async function postCloudDownloader(payload: {
  youtube_url?: string;
  s3_key?: string;
  call_id?: string;
}): Promise<{
  httpStatus: number;
  data: CloudDownloaderResponse;
  body: string;
}> {
  if (!env.DOWNLOAD_VIDEO_ENDPOINT) {
    throw new Error("DOWNLOAD_VIDEO_ENDPOINT is not configured");
  }

  const response = await fetch(env.DOWNLOAD_VIDEO_ENDPOINT, {
    method: "POST",
    body: JSON.stringify(payload),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.PROCESS_VIDEO_ENDPOINT_AUTH}`,
    },
  });
  const body = await response.text();
  let data: CloudDownloaderResponse = {};
  try {
    data = JSON.parse(body) as CloudDownloaderResponse;
  } catch {
    // Preserve the raw body for the error reported to the job record.
  }
  return { httpStatus: response.status, data, body };
}
