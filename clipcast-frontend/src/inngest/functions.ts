import { env } from "~/env";
import { inngest } from "./client";
import { creditsForDuration } from "~/lib/credits";
import { db } from "~/server/db";
import {
  clipReadyEmailHtml,
  jobFailedEmailHtml,
  queueEmail,
  sendMail,
  weeklySummaryEmailHtml,
} from "~/server/mail";

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
      const { userId, credits, s3Key, captionColor, watermarkText } =
        await step.run("check-credits", async () => {
          const uploadedFile = await db.uploadedFile.findUniqueOrThrow({
            where: { id: uploadedFileId },
            select: {
              user: {
                select: {
                  id: true,
                  credits: true,
                  captionColor: true,
                  watermarkText: true,
                },
              },
              s3Key: true,
            },
          });
          return {
            userId: uploadedFile.user.id,
            credits: uploadedFile.user.credits,
            s3Key: uploadedFile.s3Key,
            captionColor: uploadedFile.user.captionColor,
            watermarkText: uploadedFile.user.watermarkText,
          };
        });

      // Inngest memoizes completed steps: on replay (which happens after
      // every step.sleep/step.fetch below), this callback is NOT re-invoked,
      // only its return value is reused. A step that sets an outer variable
      // instead of returning its result loses that value on every replay,
      // since the mutation only ever ran once. Returning it and assigning
      // the const from the awaited step is what actually survives replay.
      const durationSeconds = await step.run("get-video-duration", async () => {
        // For YouTube jobs, get a fast, download-free duration estimate
        // (see estimateYoutubeDuration) so a 4-hour video can't start
        // processing on a 20-credit balance just because "duration unknown"
        // used to mean "gate on 1 credit and hope." A 0 result means the
        // probe failed (endpoint not configured, every proxy timed out,
        // etc.) — fall back to the old behavior (gate on the minimum) rather
        // than blocking the job over a metadata hiccup; the real duration
        // still gets measured and billed accurately after the real download.
        //
        // For direct uploads, duration is already known — fall back to any
        // stored duration (default 5 mins) purely for the up-front gate.
        try {
          const file = await db.uploadedFile.findUnique({
            where: { id: uploadedFileId },
          });
          if (youtubeUrl) {
            const estimated = await estimateYoutubeDuration(youtubeUrl);
            return estimated > 0 ? estimated : (file?.duration ?? 0);
          }

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

      // For YouTube jobs this is now usually the REAL duration (from the
      // fast estimate above), so a video the user can't afford is rejected
      // here — before the expensive download+GPU pipeline ever starts —
      // instead of only being caught by the true-up deduction afterwards.
      // If the estimate failed (durationSeconds is 0), creditsForDuration's
      // 1-credit floor is the same graceful fallback as before.
      const requiredCredits = creditsForDuration(durationSeconds, {
        clipMode,
        isPreview: previewOnly,
      });

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
        const modalResponse = await step.fetch(env.PROCESS_VIDEO_ENDPOINT, {
          method: "POST",
          body: JSON.stringify({
            s3_key: s3Key,
            // YouTube has already been downloaded to S3 by the CPU-only Modal
            // function. The L40S worker performs GPU processing only.
            youtube_url: null,
            clip_mode: clipMode,
            preview_only: previewOnly,
            // Per-user clip appearance: caption highlight color (null =
            // brand default) and optional personal watermark (null = no
            // watermark burned at all).
            caption_color: captionColor,
            watermark_text: watermarkText,
          }),
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${env.PROCESS_VIDEO_ENDPOINT_AUTH}`,
          },
        });

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
            // Only populated when the job ran in "all" mode — the specific
            // category (Q&A / Educational / Motivational / Highlights, or
            // an AI-invented tag from the "any" pass) that clip was found
            // under. Null for a job submitted with one single fixed mode.
            category?: string | null;
          }[];
        };

        // Log any per-clip render warnings (non-fatal) for debugging
        if (modalData.clip_warnings?.length) {
          console.warn(
            `[inngest] ${modalData.clip_warnings.length} clip render warning(s) for ${uploadedFileId}:`,
            modalData.clip_warnings,
          );
        }

        // Billing rule (see ~/lib/credits): 1 credit per minute of source
        // video, rounded up, with a minimum of 1 credit per processed video.
        // Guard against a 0/empty duration from Modal (which would otherwise
        // deduct nothing) by falling back to the downloader's own measured
        // duration for YouTube jobs, rather than the pre-download 0 estimate.
        const exactDuration =
          modalData.duration && modalData.duration > 0
            ? modalData.duration
            : effectiveDurationSeconds;
        const finalCreditsToDeduct = creditsForDuration(exactDuration, {
          clipMode,
          isPreview: previewOnly,
        });

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
                // "All" jobs get each clip's own category from Modal;
                // single-mode jobs fall back to the mode the job was
                // submitted with, same as before.
                clipMode: clip.category || clipMode,
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
            const creditsRemaining = currentCredits - actualDeduction;
            if (actualDeduction > 0) {
              await db.creditTransaction.create({
                data: {
                  userId,
                  type: "job_charge",
                  amount: -actualDeduction,
                  balanceAfter: creditsRemaining,
                  uploadedFileId,
                  description: previewOnly
                    ? `Preview clip job (${clipMode})`
                    : `Clip job (${clipMode})`,
                },
              });
            }
            return {
              requestedDeduction: finalCreditsToDeduct,
              actualDeduction,
              creditsRemaining,
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

          await step.run("notify-clip-ready", async () => {
            const user = await db.user.findUnique({
              where: { id: userId },
              select: { email: true, notifyClipReady: true },
            });
            if (!user?.notifyClipReady) {
              return { sent: false, reason: "opted-out" };
            }
            const file = await db.uploadedFile.findUnique({
              where: { id: uploadedFileId },
              select: { displayName: true, youtubeUrl: true },
            });
            await queueEmail({
              to: user.email,
              subject: "Your clips are ready",
              html: clipReadyEmailHtml({
                sourceTitle:
                  file?.displayName ?? file?.youtubeUrl ?? "your upload",
                clipCount: clipsFromModal.length,
              }),
            });
            return { sent: true };
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
            return {
              status: "failed",
              reason: noMomentsIdentified ? "no_moments" : "render_failed",
            };
          });

          await step.run("notify-job-failed", async () => {
            const user = await db.user.findUnique({
              where: { id: userId },
              select: { email: true, notifyJobFailed: true },
            });
            if (!user?.notifyJobFailed) {
              return { sent: false, reason: "opted-out" };
            }
            const file = await db.uploadedFile.findUnique({
              where: { id: uploadedFileId },
              select: { displayName: true, youtubeUrl: true },
            });
            await queueEmail({
              to: user.email,
              subject: "A processing job failed",
              html: jobFailedEmailHtml({
                sourceTitle:
                  file?.displayName ?? file?.youtubeUrl ?? "your upload",
                reason: noClipsMessage,
              }),
            });
            return { sent: true };
          });
        }
      } else {
        await step.run("set-status-no-credits", async () => {
          await db.uploadedFile.update({
            where: { id: uploadedFileId },
            data: { status: "no credits" },
          });
          return {
            status: "no credits",
            requiredCredits,
            availableCredits: credits,
          };
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

      // Wrapped in step.run (rather than called inline) so a retry that
      // fails at this same point doesn't queue a second copy of the email —
      // once this step resolves, Inngest memoizes it across replays like
      // every other step in this function.
      await step.run("notify-job-failed-fatal", async () => {
        const file = await db.uploadedFile.findUnique({
          where: { id: uploadedFileId },
          select: {
            displayName: true,
            youtubeUrl: true,
            user: { select: { email: true, notifyJobFailed: true } },
          },
        });
        if (!file?.user.notifyJobFailed) {
          return { sent: false, reason: "opted-out" };
        }
        await queueEmail({
          to: file.user.email,
          subject: "A processing job failed",
          html: jobFailedEmailHtml({
            sourceTitle: file.displayName ?? file.youtubeUrl ?? "your upload",
            reason: friendlyMessage,
          }),
        });
        return { sent: true };
      });

      throw error;
    }
  },
);

// ── Daily Clip Scheduler (CRON) ─────────────────────────────────────────────
// Runs every day at 09:00 UTC.
// For each user with a connected YouTube channel, fetches their latest video,
// and queues it once for processing in highlights mode.
async function getSchedulerYouTubeToken(user: {
  id: string;
  youtubeAccessToken: string | null;
  youtubeRefreshToken: string | null;
  youtubeTokenExpiry: Date | string | null;
}): Promise<string | null> {
  if (!user.youtubeAccessToken || !user.youtubeRefreshToken) return null;
  if (
    user.youtubeTokenExpiry &&
    new Date(user.youtubeTokenExpiry).getTime() > Date.now() + 5 * 60_000
  ) {
    return user.youtubeAccessToken;
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID ?? "",
      client_secret: env.GOOGLE_CLIENT_SECRET ?? "",
      refresh_token: user.youtubeRefreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!response.ok) return null;
  const token = (await response.json()) as {
    access_token: string;
    expires_in: number;
  };
  await db.user.update({
    where: { id: user.id },
    data: {
      youtubeAccessToken: token.access_token,
      youtubeTokenExpiry: new Date(Date.now() + token.expires_in * 1000),
    },
  });
  return token.access_token;
}

async function getLatestYouTubeUpload(accessToken: string) {
  const headers = { Authorization: `Bearer ${accessToken}` };
  const channelResponse = await fetch(
    "https://www.googleapis.com/youtube/v3/channels?part=contentDetails&mine=true",
    { headers },
  );
  if (!channelResponse.ok) return null;
  const channel = (await channelResponse.json()) as {
    items?: { contentDetails?: { relatedPlaylists?: { uploads?: string } } }[];
  };
  const playlistId =
    channel.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!playlistId) return null;

  const uploadResponse = await fetch(
    `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${encodeURIComponent(playlistId)}&maxResults=1`,
    { headers },
  );
  if (!uploadResponse.ok) return null;
  const uploads = (await uploadResponse.json()) as {
    items?: { snippet: { title: string; resourceId: { videoId: string } } }[];
  };
  const latest = uploads.items?.[0]?.snippet;
  return latest
    ? {
        title: latest.title,
        url: `https://www.youtube.com/watch?v=${latest.resourceId.videoId}`,
      }
    : null;
}

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
          youtubeAutoClip: true,
          credits: { gt: 0 },
        },
        select: {
          id: true,
          email: true,
          youtubeChannelId: true,
          youtubeChannelName: true,
          credits: true,
          youtubeAccessToken: true,
          youtubeRefreshToken: true,
          youtubeTokenExpiry: true,
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

    // 2. For each enabled user, queue their newest upload if it has not been
    // imported already. The URL check makes every scheduler run idempotent.
    for (const user of connectedUsers) {
      await step.run(`queue-user-${user.id}`, async () => {
        const accessToken = await getSchedulerYouTubeToken(user);
        if (!accessToken) {
          return {
            userId: user.id,
            queued: false,
            reason: "token-unavailable",
          };
        }
        const latest = await getLatestYouTubeUpload(accessToken);
        if (!latest) {
          return { userId: user.id, queued: false, reason: "no-upload" };
        }
        const alreadyImported = await db.uploadedFile.findFirst({
          where: { userId: user.id, youtubeUrl: latest.url },
          select: { id: true },
        });
        if (alreadyImported) {
          return { userId: user.id, queued: false, reason: "already-imported" };
        }

        const record = await db.uploadedFile.create({
          data: {
            userId: user.id,
            s3Key: `${crypto.randomUUID()}/original.mp4`,
            displayName: latest.title,
            youtubeUrl: latest.url,
            uploaded: true,
            clipMode: "highlights",
            isPreview: false,
          },
          select: { id: true },
        });
        await inngest.send({
          name: "process-video-events",
          data: {
            uploadedFileId: record.id,
            userId: user.id,
            youtubeUrl: latest.url,
            clipMode: "highlights",
            previewOnly: false,
          },
        });
        return { userId: user.id, queued: true, uploadedFileId: record.id };
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

// ── Email ────────────────────────────────────────────────────────────────────
// Actually calls the mail provider. Sends go through this Inngest function
// (queued via queueEmail() in ~/server/mail) instead of inline in a request
// or another step, so a slow/failing mail API gets Inngest's own retries
// and can never block or fail the mutation that triggered it.
export const sendEmailFn = inngest.createFunction(
  { id: "send-email", retries: 3 },
  { event: "email/send" },
  async ({ event }) => {
    const { to, subject, html } = event.data as {
      to: string;
      subject: string;
      html: string;
    };
    const result = await sendMail({ to, subject, html });
    return result;
  },
);

// ── Weekly Summary (CRON) ───────────────────────────────────────────────────
// Runs every Monday at 09:00 UTC. Emails each opted-in user the clips
// rendered from their uploads in the last 7 days.
export const weeklySummaryScheduler = inngest.createFunction(
  { id: "weekly-summary-scheduler", retries: 0 },
  { cron: "0 9 * * 1" },
  async ({ step }) => {
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const users = await step.run("get-opted-in-users", async () => {
      return await db.user.findMany({
        where: {
          notifyWeeklySummary: true,
          clips: { some: { createdAt: { gte: oneWeekAgo } } },
        },
        select: {
          id: true,
          email: true,
          clips: {
            where: { createdAt: { gte: oneWeekAgo } },
            select: { title: true, s3Key: true, clipMode: true },
            orderBy: { createdAt: "desc" },
            take: 10,
          },
        },
      });
    });

    if (users.length === 0) {
      return { skipped: true, reason: "no-opted-in-users-with-clips" };
    }

    for (const user of users) {
      await step.run(`email-user-${user.id}`, async () => {
        await queueEmail({
          to: user.email,
          subject: "Your week in clips",
          html: weeklySummaryEmailHtml({
            clipTitles: user.clips.map((c) => c.title ?? `${c.clipMode} clip`),
          }),
        });
        return { userId: user.id, clipCount: user.clips.length };
      });
    }

    return { emailed: users.length };
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
 * Fast, download-free duration estimate for a YouTube URL, used to gate
 * credits before the full download+GPU pipeline starts. Returns 0 if the
 * endpoint isn't configured, times out, or the probe otherwise fails —
 * callers should treat that as "unknown" and fall back to the old
 * minimum-credit gate rather than blocking the job over a metadata hiccup.
 */
async function estimateYoutubeDuration(youtubeUrl: string): Promise<number> {
  if (!env.YOUTUBE_DURATION_ENDPOINT) return 0;
  try {
    const response = await fetch(env.YOUTUBE_DURATION_ENDPOINT, {
      method: "POST",
      body: JSON.stringify({ youtube_url: youtubeUrl }),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.PROCESS_VIDEO_ENDPOINT_AUTH}`,
      },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) return 0;
    const data = (await response.json()) as { duration?: number };
    return typeof data.duration === "number" && data.duration > 0
      ? data.duration
      : 0;
  } catch (err) {
    console.warn("[inngest] estimateYoutubeDuration failed:", err);
    return 0;
  }
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
    if (
      rawDetail.toLowerCase().includes("memory") ||
      rawDetail.toLowerCase().includes("cuda")
    ) {
      return {
        friendly:
          "This video needs more processing power than is available right " +
          "now. Try a shorter video, or use Preview mode.",
        detail,
      };
    }
    return {
      friendly:
        "Our processing service is temporarily unavailable. Please try again shortly.",
      detail,
    };
  }
  return { friendly: GENERIC_FRIENDLY_ERROR, detail };
}
