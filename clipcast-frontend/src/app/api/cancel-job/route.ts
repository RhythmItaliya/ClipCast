import { type NextRequest, NextResponse } from "next/server";
import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { inngest } from "~/inngest/client";

/**
 * POST /api/cancel-job
 * Marks a queued or processing job as "cancelled" in the DB.
 * Body: { fileId: string }
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let fileId: string | undefined;
  try {
    const body = (await req.json()) as { fileId?: string };
    fileId = body.fileId;
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 },
    );
  }

  if (!fileId) {
    return NextResponse.json({ error: "fileId is required" }, { status: 400 });
  }

  const file = await db.uploadedFile.findFirst({
    where: { id: fileId, userId: session.user.id },
    select: { id: true, status: true },
  });

  if (!file) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  // Only allow cancelling jobs that are queued or processing
  if (file.status !== "queued" && file.status !== "processing") {
    return NextResponse.json(
      { error: `Cannot cancel a job with status "${file.status}"` },
      { status: 400 },
    );
  }

  await db.uploadedFile.update({
    where: { id: fileId },
    data: { status: "cancelled" },
  });

  await inngest.send({
    name: "cancel-job-events",
    data: {
      uploadedFileId: fileId,
    },
  });

  return NextResponse.json({
    cancelled: true,
    message: "Job cancelled successfully",
  });
}
