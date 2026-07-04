import { NextResponse } from "next/server";
import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { getUsageStats } from "~/server/usage";

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
          where: {
            uploaded: true,
          },
          select: {
            id: true,
            s3Key: true,
            displayName: true,
            youtubeUrl: true,
            status: true,
            clipMode: true,
            isPreview: true,
            errorMessage: true,
            processingSummary: true,
            createdAt: true,
            updatedAt: true,
            _count: {
              select: {
                clips: true,
              },
            },
          },
          orderBy: {
            createdAt: "desc",
          },
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

  const formattedFiles = userData.uploadedFiles.map((file) => ({
    id: file.id,
    s3Key: file.s3Key,
    filename: file.displayName ?? "Unknown filename",
    youtubeUrl: file.youtubeUrl,
    status: file.status,
    clipMode: file.clipMode,
    isPreview: file.isPreview,
    errorMessage: file.errorMessage ?? null,
    processingSummary: file.processingSummary ?? null,
    clipsCount: file._count.clips,
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
  }));

  return NextResponse.json({
    uploadedFiles: formattedFiles,
    credits: usage.creditsRemaining,
    uploadsToday: usage.uploadsToday,
    activeJobs: usage.activeJobs,
  });
}
