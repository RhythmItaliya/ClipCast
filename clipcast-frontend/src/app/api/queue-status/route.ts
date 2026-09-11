import { NextResponse } from "next/server";
import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { QUEUE_FILE_SELECT, toQueueFile } from "~/server/queue";
import { getUsageStats } from "~/server/usage";

/**
 * GET /api/queue-status
 * Polling endpoint the dashboard hits on an interval to refresh the current
 * user's job queue plus live usage stats (credits, uploads today, active jobs)
 * without a full page reload.
 */
export async function GET() {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [userData, usage] = await Promise.all([
    db.user.findUnique({
      where: { id: session.user.id },
      select: {
        uploadedFiles: {
          where: { uploaded: true },
          select: QUEUE_FILE_SELECT,
          orderBy: { createdAt: "desc" },
        },
      },
    }),
    // Same source of truth the actual usage gates use (src/server/usage.ts),
    // so the live-polled stats never drift from what's actually enforced.
    getUsageStats(session.user.id),
  ]);

  if (!userData) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  return NextResponse.json({
    uploadedFiles: userData.uploadedFiles.map(toQueueFile),
    credits: usage.creditsRemaining,
    uploadsToday: usage.uploadsToday,
    activeJobs: usage.activeJobs,
  });
}
