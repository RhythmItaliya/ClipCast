import { env } from "~/env";
import { inngest } from "./client";
import { db } from "~/server/db";

// ── Video Processing ────────────────────────────────────────────────────────
export const processVideoFn = inngest.createFunction(
  {
    id: "process-video",
    retries: 1,
    // One active job per user at a time — prevents GPU resource contention
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

        // ── YouTube download phase ─────────────────────────────────────────
        // YouTube sources pass through a CPU-only Modal downloader and land in
        // S3. The GPU worker then reads only from S3, so neither stage
        // consumes Inngest execution time waiting for the download to finish.
        if (youtubeUrl) {
          if (!env.DOWNLOAD_VIDEO_ENDPOINT) {
            throw new Error(
              "YTDLP_ERROR: DOWNLOAD_VIDEO_ENDPOINT is not configured. " +
              "Add it to your .env and restart.",
            );
          }

          // Step 1 — submit the download job (returns call_id immediately)
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
              `YTDLP_ERROR: Could not submit cloud download (HTTP ${submitted.httpStatus}): ` +
              submitted.body.slice(0, 800),
            );
          }

          // Step 2 — give the worker a head-start before polling.
          // step.sleep does NOT consume execution time — Inngest parks the
          // function run and resumes it after the delay. This is the correct
          // way to wait in Inngest (NOT setTimeout inside a step.run).
          await step.sleep("wait-for-download-start", "30s");

          // Step 3 — poll loop using proper Inngest step.sleep between polls.
          // Each poll is a separate step.run so Inngest can replay them safely.
          // MAX 40 poll attempts × 30-45s ≈ up to ~30 minutes of polling.
          const MAX_POLL_ATTEMPTS = 40;
          let downloadData: CloudDownloaderResponse | null = null;

          for (let attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt++) {
            const pollResult = await step.run(
              // Unique step name per attempt — Inngest deduplicates on replay
              `poll-download-attempt-${attempt}`,
              async () => postCloudDownloader({ call_id: callId }),
            );

            if (pollResult.httpStatus === 202) {
              // Still in progress — sleep between polls (proper Inngest pause)
              // Use exponential back-off: 15s → 30s → 45s → cap at 60s
              const delaySecs = Math.min(15 + (attempt - 1) * 5, 60);
              await step.sleep(
                `wait-between-polls-${attempt}`,
                `${delaySecs}s`,
              );
              continue;
            }

            if (pollResult.httpStatus < 200 || pollResult.httpStatus >= 300) {
              const detail =
                (pollResult.data as { detail?: string }).detail ??
                pollResult.body.slice(0, 600);
              throw new Error(
                `YTDLP_ERROR: Cloud download failed (HTTP ${pollResult.httpStatus}): ${detail}`,
              );
            }

            // Completed successfully
            downloadData = pollResult.data;
            break;
          }

          if (!downloadData) {
            throw new Error(
              "YTDLP_ERROR: Cloud download did not finish within 40 poll attempts (~30 min). " +
              "The video may be too long or the proxy is blocked.",
            );
          }

          if (downloadData.duration && downloadData.duration > 0) {
            durationSeconds = downloadData.duration;
          }
        }

        // ── GPU processing phase ───────────────────────────────────────────
        // step.fetch offloads the HTTP request to the Inngest Platform so
        // your Next.js server is NOT blocked waiting for it — the function is
        // parked and resumed when Modal replies. This avoids the serverless
        // timeout that would kill a plain fetch() after 10-60 seconds.
        //
        // step.fetch(url, options) — URL is the first argument (no step ID).
        const modalResponse = await step.fetch(
          env.PROCESS_VIDEO_ENDPOINT,
          {
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
          },
        );

        if (!modalResponse.ok) {
          const errText = await modalResponse.text().catch(() => "");
          // Map common Modal/processor HTTP codes to user-friendly messages
          const friendlyDetail = parseProcessorError(
            modalResponse.status,
            errText,
          );
          throw new Error(
            `Modal GPU processor returned ${modalResponse.status}: ${friendlyDetail}`,
          );
        }

        const modalData = (await modalResponse.json()) as {
          duration?: number;
          clips_found?: number;
          clips_rendered?: number;
          clip_warnings?: string[];
          clips?: {
            s3_key: string;
            thumbnail_s3_key?: string;
            title?: string;
            duration?: number;
          }[];
        };

        // Log any per-clip render warnings (non-fatal) for debugging
        if (modalData.clip_warnings?.length) {
          console.warn(
            `[inngest] ${modalData.clip_warnings.length} clip render warning(s) for ${uploadedFileId}:`,
            modalData.clip_warnings,
          );
        }

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
          const clips = modalData.clips ?? [];
          if (clips.length > 0) {
            await db.clip.createMany({
              data: clips.map((clip) => ({
                s3Key: clip.s3_key,
                thumbnailS3Key: clip.thumbnail_s3_key ?? null,
                title: clip.title || null,
                duration: clip.duration ?? null,
                uploadedFileId,
                userId,
                clipMode,
                isPreview: previewOnly,
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

    // Bail early — no connected users means no work. Avoids creating
    // unnecessary per-user steps that would just log "nothing to do".
    if (connectedUsers.length === 0) {
      return { skipped: true, reason: "no-connected-users" };
    }

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
type CloudDownloaderResponse = {
  status?: string;
  call_id?: string;
  duration?: number;
  detail?: string;
  s3_key?: string;
  source_bytes?: number;
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

/**
 * Map Modal processor HTTP error codes to user-readable messages.
 * These are stored in uploadedFile.errorMessage and shown in the queue UI.
 */
function parseProcessorError(httpStatus: number, body: string): string {
  let detail = "";
  try {
    const parsed = JSON.parse(body) as { detail?: string };
    detail = parsed.detail ?? body;
  } catch {
    detail = body;
  }
  detail = detail.slice(0, 400);

  // Use HTTP status as first signal
  if (httpStatus === 404) {
    return `Source video not found in S3. The download may not have completed. (${detail})`;
  }
  if (httpStatus === 422) {
    return `The video file is invalid or has no usable audio. Try a different video. (${detail})`;
  }
  if (httpStatus === 429) {
    return `Gemini API rate limit hit. Wait a few minutes and retry. (${detail})`;
  }
  if (httpStatus === 503) {
    if (detail.toLowerCase().includes("memory") || detail.toLowerCase().includes("cuda")) {
      return "GPU ran out of memory. Try a shorter video or use Preview mode.";
    }
    return `Processing service temporarily unavailable. (${detail})`;
  }
  if (httpStatus === 401) {
    return "Authentication error with the processing endpoint. Contact support.";
  }
  if (httpStatus >= 500) {
    return `Processing server error. Check Modal logs for details. (${detail})`;
  }
  return detail || `Unexpected error (HTTP ${httpStatus})`;
}
