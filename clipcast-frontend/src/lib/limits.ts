/**
 * Usage limits for ClipCast — single source of truth, enforced server-side
 * in the actions and mirrored client-side for instant feedback.
 */
export const LIMITS = {
  /**
   * Maximum upload size in bytes (4 GiB). A single (non-multipart) S3
   * presigned PUT tops out at 5 GiB, so this stays safely under that hard
   * ceiling while still covering a multi-hour podcast video: ~3.9GB for a
   * 4-hour recording at a typical ~2.2 Mbps talking-head bitrate.
   */
  MAX_FILE_SIZE_BYTES: 4 * 1024 * 1024 * 1024,
  MAX_FILE_SIZE_LABEL: "4GB",
  /** Only mp4 uploads are supported by the pipeline. */
  ALLOWED_EXTENSIONS: ["mp4"],
  ALLOWED_CONTENT_TYPES: ["video/mp4"],
  /**
   * Maximum source video length billed/processed (minutes). Matched to the
   * processor's Modal timeout (see apps/processor/main.py) and the
   * downloader's proxy deadline (apps/downloader/main.py) — raising this
   * without raising those too just moves the failure from "rejected upfront"
   * to "times out partway through processing."
   */
  MAX_DURATION_MINUTES: 240,
  /** Maximum jobs a user may submit per rolling 24 hours. */
  MAX_UPLOADS_PER_DAY: 10,
  /** Maximum jobs allowed in "queued"/"processing" at the same time. */
  MAX_ACTIVE_JOBS: 2,
  /** Minimum credits required to submit any job. */
  MIN_CREDITS_TO_SUBMIT: 1,
} as const;

export type UsageStats = {
  creditsRemaining: number;
  uploadsToday: number;
  activeJobs: number;
};

/** Human-readable reason a submission is blocked, or null when allowed. */
export function getUsageBlockReason(stats: UsageStats): string | null {
  if (stats.creditsRemaining < LIMITS.MIN_CREDITS_TO_SUBMIT) {
    return "You're out of credits. Buy a credit pack to keep clipping.";
  }
  if (stats.activeJobs >= LIMITS.MAX_ACTIVE_JOBS) {
    return `You already have ${stats.activeJobs} jobs running. Wait for one to finish before starting another.`;
  }
  if (stats.uploadsToday >= LIMITS.MAX_UPLOADS_PER_DAY) {
    return `Daily limit reached (${LIMITS.MAX_UPLOADS_PER_DAY} videos per 24h). Please try again tomorrow.`;
  }
  return null;
}
