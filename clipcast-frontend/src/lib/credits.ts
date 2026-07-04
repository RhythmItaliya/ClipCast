/**
 * Single source of truth for ClipCast's billing rule: 1 credit per minute
 * of video, rounded up, with a minimum of 1 credit per job. Every place
 * that turns a duration into a credit cost — the upfront gate before
 * processing starts and the true-up deduction after the real duration is
 * known — must call `creditsForDuration` from here instead of doing its
 * own `Math.ceil(seconds / 60)`, so the rule can never drift between call
 * sites.
 */

export const CREDITS_PER_MINUTE = 1;

// "All" mode fans out over every category (Q&A, Educational, Motivational,
// Highlights, Others) — roughly 5x the Gemini calls of a single-mode job —
// so it carries a surcharge rather than billing the same as a single-mode
// job that does 1/5th the AI work.
export const ALL_MODE_SURCHARGE_MULTIPLIER = 1.5;

// Preview clips are 480p and skip the ASD/TalkNet speaker-detection pass
// (see create_preview_clip in the processor) — genuinely cheaper to
// produce, so they're billed at half rate.
export const PREVIEW_MODE_DISCOUNT_MULTIPLIER = 0.5;

// Duration reads (ffprobe/OpenCV on the backend, or a browser's own
// metadata probe) can overshoot a clean boundary by a few milliseconds of
// floating-point noise. This tolerance absorbs that jitter so a video
// that's really exactly 3:00 doesn't get billed as 3:01 -> 4 credits. It's
// far too small to meaningfully under-bill anything genuinely past a
// minute boundary (2:45 still correctly rounds up to 3 credits).
const DURATION_JITTER_TOLERANCE_SECONDS = 0.05;

/**
 * Converts a duration in seconds to a whole-credit cost, adjusted for the
 * job's mode/quality tier.
 *
 * Handles every input scenario a duration reading can produce:
 * - A normal duration (e.g. 165s / 2:45 -> 3 credits): rounds up to the
 *   next whole minute.
 * - Exactly on a minute boundary (e.g. 120s -> 2 credits, not 3): the
 *   jitter tolerance above prevents float noise from pushing it over.
 * - Zero, negative, NaN, Infinity, or otherwise not-yet-known (e.g. a
 *   YouTube job before the video's been downloaded and measured): billed
 *   at the 1-credit minimum rather than 0, so a job can never be gated in
 *   or charged for free.
 * - A duration far longer than any real clip (e.g. a corrupted metadata
 *   read reporting years): still just rounds up normally — the 120-minute
 *   platform upload cap and per-job clip-count caps are enforced
 *   elsewhere, not here; this function only ever answers "how many
 *   credits does this many seconds cost."
 * - clipMode "all" and/or isPreview both apply their multiplier to the
 *   same underlying minute count before the final ceil/floor, so
 *   multipliers compose correctly instead of double-rounding — and a job
 *   can never round down to 0 credits even after a discount.
 */
export function creditsForDuration(
  durationSeconds: number,
  opts: { clipMode?: string; isPreview?: boolean } = {},
): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return 1;
  }
  const adjustedSeconds = Math.max(
    0,
    durationSeconds - DURATION_JITTER_TOLERANCE_SECONDS,
  );
  let minutes = adjustedSeconds / 60;
  if (opts.clipMode === "all") minutes *= ALL_MODE_SURCHARGE_MULTIPLIER;
  if (opts.isPreview) minutes *= PREVIEW_MODE_DISCOUNT_MULTIPLIER;
  return Math.max(1, Math.ceil(minutes));
}
