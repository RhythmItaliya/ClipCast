import { db } from "~/server/db";

/**
 * A user may have at most this many jobs (audio + clip combined) running at
 * once; beyond it they must wait. This protects Modal GPU cost and keeps every
 * user's queue responsive instead of one person saturating the workers.
 */
export const MAX_CONCURRENT_JOBS = 2;

// A job is "active" from creation until it reaches a terminal state.
const ACTIVE_STATUSES = ["queued", "processing"];

/**
 * Returns a user-facing message when the caller is already at the concurrency
 * limit, or null when they may start another job. Audio and clip jobs share
 * the same limit — they both run on the same Modal backends.
 */
export async function checkConcurrencyLimit(
  userId: string,
  // The upload flow creates the job row (status "queued") before it starts
  // processing, so that row must be excluded from its own count.
  excludeId?: string,
): Promise<string | null> {
  const active = await db.uploadedFile.count({
    where: {
      userId,
      status: { in: ACTIVE_STATUSES },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
  });
  if (active >= MAX_CONCURRENT_JOBS) {
    return `You already have ${MAX_CONCURRENT_JOBS} jobs running. Please wait for one to finish before starting another.`;
  }
  return null;
}
