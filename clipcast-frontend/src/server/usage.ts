import { LIMITS, getUsageBlockReason, type UsageStats } from "~/lib/limits";
import { db } from "~/server/db";

/** Current usage numbers for a user (rolling 24h window for daily cap). */
export async function getUsageStats(userId: string): Promise<UsageStats> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [user, uploadsToday, activeJobs] = await Promise.all([
    db.user.findUnique({
      where: { id: userId },
      select: { credits: true },
    }),
    db.uploadedFile.count({
      where: { userId, createdAt: { gte: since } },
    }),
    db.uploadedFile.count({
      where: { userId, status: { in: ["queued", "processing"] } },
    }),
  ]);

  return {
    creditsRemaining: user?.credits ?? 0,
    uploadsToday,
    activeJobs,
  };
}

/**
 * Server-side submission gate. Returns null when the user may submit a new
 * job, otherwise a user-friendly reason. Never trusts the client.
 */
export async function checkUsageLimits(userId: string): Promise<string | null> {
  const stats = await getUsageStats(userId);
  return getUsageBlockReason(stats);
}

/** Validate an upload's file metadata server-side. */
export function validateUploadFile(fileInfo: {
  filename: string;
  contentType: string;
  size?: number;
}): string | null {
  const ext = fileInfo.filename.split(".").pop()?.toLowerCase() ?? "";
  if (!(LIMITS.ALLOWED_EXTENSIONS as readonly string[]).includes(ext)) {
    return `Only ${LIMITS.ALLOWED_EXTENSIONS.join(", ").toUpperCase()} files are supported.`;
  }
  if (
    !(LIMITS.ALLOWED_CONTENT_TYPES as readonly string[]).includes(
      fileInfo.contentType,
    )
  ) {
    return "That file type isn't supported — please upload an MP4 video.";
  }
  if (
    typeof fileInfo.size === "number" &&
    fileInfo.size > LIMITS.MAX_FILE_SIZE_BYTES
  ) {
    return `That file is too large. The maximum size is ${LIMITS.MAX_FILE_SIZE_LABEL}.`;
  }
  return null;
}
