import { env } from "~/env";
import { inngest } from "./client";
import { db } from "~/server/db";

/**
 * Carries two versions of a failure: `friendlyMessage` (shown to the job's
 * own user — plain language, never mentions proxies, HTTP codes, S3, Modal,
 * or GPUs by name) and the raw `message` (the Error's own message, shown
 * only in the admin panel). Every throw site in processVideoFn should throw
 * this instead of a plain Error, so no raw backend text ever reaches a
 * regular user's screen.
 */
class JobProcessingError extends Error {
  readonly friendlyMessage: string;
  constructor(friendlyMessage: string, technicalDetail: string) {
    super(technicalDetail);
    this.name = "JobProcessingError";
    this.friendlyMessage = friendlyMessage;
  }
}

const GENERIC_FRIENDLY_ERROR =
  "Something went wrong while processing your video. Please try again, and contact support if it keeps happening.";

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

      // Inngest memoizes completed steps: on replay (which happens after
      // every step.sleep/step.fetch below), this callback is NOT re-invoked,
      // only its return value is reused. A step that sets an outer variable
      // instead of returning its result loses that value on every replay,
      // since the mutation only ever ran once. Returning it and assigning
      // the const from the awaited step is what actually survives replay.
      const durationSeconds = await step.run("get-video-duration", async () => {
        // No local yt-dlp here: for YouTube jobs the real duration is measured
        // on the Modal worker after it downloads the video (exact credits are
        // deducted afterwards). For direct uploads we fall back to any stored
        // duration (default 5 mins) purely for the up-front credit gate.
        try {
          const file = await db.uploadedFile.findUnique({
            where: { id: uploadedFileId },
          });
          if (youtubeUrl) return file?.duration ?? 0;

          const fallbackDuration = file?.duration ?? 300;
          await db.uploadedFile.update({
            where: { id: uploadedFileId },
            data: { duration: Math.round(fallbackDuration) },
          });
          return fallbackDuration;
        } catch (e) {
          console.warn("Could not determine duration", e);
          return youtubeUrl ? 0 : 300;
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
            // Clear any error left over from a previous failed attempt —
            // otherwise a retried job shows a fresh "Processing" badge next
            // to a stale error message from the run before it.
            data: {
              status: "processing",
              errorMessage: null,
              internalErrorDetail: null,
            },
          });
          return { status: "processing" };
        });

        // Plain reassignment based on an already-resolved step result below,
        // not a mutation Inngest needs to replay — safe, unlike the pattern
        // get-video-duration used to have.
        let effectiveDurationSeconds = durationSeconds;

        // ── YouTube download phase ─────────────────────────────────────────
        // YouTube sources pass through a CPU-only Modal downloader and land in
        // S3. The GPU worker then reads only from S3, so neither stage
        // consumes Inngest execution time waiting for the download to finish.
        if (youtubeUrl) {
          // Shared wording for the download-phase failures below: the user
          // doesn't need to know this runs through a rotating proxy pool, or
          // what HTTP status came back — just that it's usually temporary
          // and what to try next.
          const DOWNLOAD_FAILED_FRIENDLY =
            "We couldn't download this YouTube video right now. This is " +
            "usually temporary, try again in a few minutes, or upload the " +
            "file directly instead.";

          if (!env.DOWNLOAD_VIDEO_ENDPOINT) {
            throw new JobProcessingError(
              "YouTube downloads aren't available right now. Please try " +
                "uploading the file directly, or try again later.",
              "DOWNLOAD_VIDEO_ENDPOINT is not configured. Add it to .env and restart.",
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
            throw new JobProcessingError(
              DOWNLOAD_FAILED_FRIENDLY,
              `Could not submit cloud download (HTTP ${submitted.httpStatus}): ` +
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
          // Backoff caps at 60s/poll, so this budgets ~85 minutes of polling,
          // comfortably above the downloader's own OVERALL_DEADLINE_SECONDS
          // (3600s / 60 min, see apps/downloader/main.py) for a multi-hour
          // source downloaded through a rotating free proxy.
          const MAX_POLL_ATTEMPTS = 90;
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
              throw new JobProcessingError(
                DOWNLOAD_FAILED_FRIENDLY,
                `Cloud download failed (HTTP ${pollResult.httpStatus}): ${detail}`,
              );
            }

            // Completed successfully
            downloadData = pollResult.data;
            break;
          }

          if (!downloadData) {
            throw new JobProcessingError(
              "This video is taking longer than expected to download. It " +
                "may be too long, or YouTube downloads are temporarily " +
                "restricted. Please try again later.",
              "Cloud download did not finish within 90 poll attempts (~85 min). " +
                "The video may be too long or the proxy is blocked.",
            );
          }

          if (downloadData.duration && downloadData.duration > 0) {
            effectiveDurationSeconds = downloadData.duration;
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
          const { friendly, detail } = parseProcessorError(
            modalResponse.status,
            errText,
          );
          throw new JobProcessingError(friendly, detail);
        }

        const modalData = (await modalResponse.json()) as {
          duration?: number;
          clips_found?: number;
          clips_rendered?: number;
          clip_warnings?: string[];
          processing_summary?: string;
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
        // duration from Modal (which would otherwise deduct nothing) by
        // falling back to the downloader's own measured duration for
        // YouTube jobs, rather than the pre-download 0 estimate.
        const exactDuration =
          modalData.duration && modalData.duration > 0
            ? modalData.duration
            : effectiveDurationSeconds;
        const finalCreditsToDeduct = Math.max(1, Math.ceil(exactDuration / 60));

        await step.run("update-exact-duration", async () => {
          await db.uploadedFile.update({
            where: { id: uploadedFileId },
            data: {
              duration: Math.round(exactDuration),
              processingSummary: modalData.processing_summary ?? null,
            },
          });
          return {
            duration: Math.round(exactDuration),
            processingSummary: modalData.processing_summary ?? null,
          };
        });

        const clipsFromModal = modalData.clips ?? [];

        await step.run("create-clips-in-db", async () => {
          if (clipsFromModal.length > 0) {
            await db.clip.createMany({
              data: clipsFromModal.map((clip) => ({
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
          return { clipsCreated: clipsFromModal.length };
        });

        // Billing rule: only charge once the job actually produced something.
        // A video that fully processes (transcribed, no crash) but whose
        // moment-identification step comes back empty — most commonly a very
        // long source with no clear standalone highlights, or a transient
        // model hiccup — used to still deduct a full duration-based credit
        // charge. That's not fair to the user: they got zero clips for their
        // credits. Skip the charge entirely and fail the job with a clear,
        // specific message instead of the generic "processed" status.
        if (clipsFromModal.length > 0) {
          await step.run("deduct-credits", async () => {
            // The upfront gate only checked for a minimum of 1 credit for
            // YouTube jobs (real duration is unknown until download), so the
            // true-up here can call for far more than that. Clamp the
            // decrement to what the user actually has so a job never pushes
            // their balance negative — they keep the clips they were just
            // rendered (the GPU cost is already spent), just at a 0 balance
            // instead of an owed-money one.
            const user = await db.user.findUnique({
              where: { id: userId },
              select: { credits: true },
            });
            const currentCredits = user?.credits ?? 0;
            const actualDeduction = Math.min(
              finalCreditsToDeduct,
              Math.max(0, currentCredits),
            );
            await db.user.update({
              where: { id: userId },
              data: { credits: { decrement: actualDeduction } },
            });
            return {
              requestedDeduction: finalCreditsToDeduct,
              actualDeduction,
              creditsRemaining: currentCredits - actualDeduction,
            };
          });

          await step.run("set-status-processed", async () => {
            await db.uploadedFile.update({
              where: { id: uploadedFileId },
              data: {
                status: "processed",
                // Clear any error text left from a prior failed attempt on
                // this same job — a completed job should never still show
                // stale red error text from before it succeeded.
                errorMessage: null,
                internalErrorDetail: null,
              },
            });
            return { status: "processed" };
          });
        } else {
          const noMomentsIdentified = !modalData.clips_found;
          const noClipsMessage = noMomentsIdentified
            ? "No usable moments were found in this video, so no clips " +
              "were created. You have not been charged for this job."
            : "Moments were found but every clip failed to render, so no " +
              "clips were created. You have not been charged for this job.";
          // Admin-only detail: which/how many clips were identified vs.
          // rendered, and any per-clip render errors, for debugging.
          const noClipsDetail =
            `clips_found=${modalData.clips_found ?? 0}, ` +
            `clips_rendered=${modalData.clips_rendered ?? 0}` +
            (modalData.clip_warnings?.length
              ? `; warnings: ${modalData.clip_warnings.join("; ")}`
              : "");
          await step.run("set-status-no-clips", async () => {
            await db.uploadedFile.update({
              where: { id: uploadedFileId },
              data: {
                status: "failed",
                errorMessage: noClipsMessage,
                internalErrorDetail: noClipsDetail,
              },
            });
            return { status: "failed", reason: noMomentsIdentified ? "no_moments" : "render_failed" };
          });
        }
      } else {
        await step.run("set-status-no-credits", async () => {
          await db.uploadedFile.update({
            where: { id: uploadedFileId },
            data: { status: "no credits" },
          });
          return { status: "no credits", requiredCredits, availableCredits: credits };
        });
      }
    } catch (error: unknown) {
      const technicalDetail =
        error instanceof Error ? error.message : String(error);
      const friendlyMessage =
        error instanceof JobProcessingError
          ? error.friendlyMessage
          : GENERIC_FRIENDLY_ERROR;
      console.error(
        `[inngest] processVideo failed for ${uploadedFileId}:`,
        technicalDetail,
      );
      await db.uploadedFile.update({
        where: { id: uploadedFileId },
        data: {
          status: "failed",
          errorMessage: friendlyMessage,
          internalErrorDetail: technicalDetail,
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
        return { userId: user.id, queued: false, reason: "auto-clip upload not yet implemented" };
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
 * Splits a processor failure into a friendly message (no HTTP codes, no
 * infrastructure names — shown to the job's own user) and the raw detail
 * (shown only in the admin panel, stored in internalErrorDetail).
 */
function parseProcessorError(
  httpStatus: number,
  body: string,
): { friendly: string; detail: string } {
  let rawDetail = "";
  try {
    const parsed = JSON.parse(body) as { detail?: string };
    rawDetail = parsed.detail ?? body;
  } catch {
    rawDetail = body;
  }
  const detail = `HTTP ${httpStatus}: ${rawDetail.slice(0, 400)}`;

  if (httpStatus === 404) {
    return {
      friendly:
        "We couldn't find your uploaded video. Please try uploading it again.",
      detail,
    };
  }
  if (httpStatus === 422) {
    return {
      friendly:
        "This video file couldn't be processed. Make sure it's a valid " +
        "video with audio, then try again.",
      detail,
    };
  }
  if (httpStatus === 429) {
    return {
      friendly:
        "Our clipping engine is briefly busy. Please wait a few minutes and try again.",
      detail,
    };
  }
  if (httpStatus === 503) {
    if (rawDetail.toLowerCase().includes("memory") || rawDetail.toLowerCase().includes("cuda")) {
      return {
        friendly:
          "This video needs more processing power than is available right " +
          "now. Try a shorter video, or use Preview mode.",
        detail,
      };
    }
    return {
      friendly: "Our processing service is temporarily unavailable. Please try again shortly.",
      detail,
    };
  }
  return { friendly: GENERIC_FRIENDLY_ERROR, detail };
}
