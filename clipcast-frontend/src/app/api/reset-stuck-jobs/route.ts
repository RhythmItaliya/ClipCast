import { type NextRequest, NextResponse } from "next/server";
import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { inngest } from "~/inngest/client";
/**
 * POST /api/reset-stuck-jobs
 * Manually retries jobs that have explicitly "failed" or been "cancelled"
 * back to "queued", then re-sends the Inngest event.
 * Note: Keeps the old /reset-stuck-jobs URL for backwards compatibility.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Expecting body: { fileId } to reset a specific file
  let fileId: string | undefined;
  try {
    const body = (await req.json()) as { fileId?: string };
    fileId = body.fileId;
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  if (!fileId) {
    return NextResponse.json({ error: "fileId is required" }, { status: 400 });
  }

  const specificFile = await db.uploadedFile.findFirst({
    where: { id: fileId, userId: session.user.id },
    select: {
      id: true,
      s3Key: true,
      userId: true,
      youtubeUrl: true,
      status: true,
    },
  });

  if (!specificFile) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  if (specificFile.status !== "failed" && specificFile.status !== "cancelled") {
    return NextResponse.json(
      { error: "Can only retry failed or cancelled jobs" },
      { status: 400 },
    );
  }

  // Reset status and re-fire Inngest events
  await db.uploadedFile.update({
    where: { id: fileId },
    data: { status: "queued" },
  });

  await inngest.send({
    name: "process-video-events",
    data: {
      uploadedFileId: specificFile.id,
      userId: specificFile.userId,
      ...(specificFile.youtubeUrl
        ? { youtubeUrl: specificFile.youtubeUrl }
        : {}),
      clipMode: "qa",
      previewOnly: false,
    },
  });

  return NextResponse.json({
    reset: 1,
    message: `Reset and re-queued the job`,
  });
}
