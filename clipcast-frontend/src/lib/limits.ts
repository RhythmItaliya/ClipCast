/**
 * Usage limits for ClipCast — single source of truth, enforced server-side
 * in the actions and mirrored client-side for instant feedback.
 */
export const LIMITS = {
  /** Maximum upload size in bytes (500 MB). */
  MAX_FILE_SIZE_BYTES: 500 * 1024 * 1024,
  MAX_FILE_SIZE_LABEL: "500MB",
  /** Only mp4 uploads are supported by the pipeline. */
  ALLOWED_EXTENSIONS: ["mp4"],
  ALLOWED_CONTENT_TYPES: ["video/mp4"],
  /** Maximum source video length billed/processed (minutes). */
  MAX_DURATION_MINUTES: 120,
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
