"use server";

import { revalidatePath } from "next/cache";
import { v4 as uuidv4 } from "uuid";
import { inngest } from "~/inngest/client";
import { auth } from "~/server/auth";
import { db } from "~/server/db";

async function sendInngestEvent(
  name: string,
  data: Record<string, unknown>,
): Promise<void> {
  try {
    await inngest.send({ name, data });
  } catch (err) {
    console.warn(`[inngest] send "${name}" failed (non-fatal):`, err);
  }
}

export async function processVideo(
  uploadedFileId: string,
  clipMode = "qa",
  previewOnly = false,
) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const uploadedVideo = await db.uploadedFile.findUniqueOrThrow({
    where: { id: uploadedFileId, userId: session.user.id },
    select: { uploaded: true, id: true, userId: true },
  });

  if (uploadedVideo.uploaded) return;

  await db.uploadedFile.update({
    where: { id: uploadedFileId },
    data: { uploaded: true, clipMode, isPreview: previewOnly },
  });

  await sendInngestEvent("process-video-events", {
    uploadedFileId: uploadedVideo.id,
    userId: uploadedVideo.userId,
    clipMode,
    previewOnly,
  });

  revalidatePath("/dashboard");
}

/**
 * Accepts a YouTube URL, creates an UploadedFile record (with a pre-assigned
 * S3 folder key so Modal knows where to write clips), and fires the Inngest
 * event. Modal will download the video itself via yt-dlp — no browser upload.
 */
export async function processYoutubeVideo(
  youtubeUrl: string,
  clipMode = "qa",
  previewOnly = false,
): Promise<{ success: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: "Unauthorized" };

  const ytRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+/;
  if (!ytRegex.test(youtubeUrl)) {
    return { success: false, error: "Please enter a valid YouTube URL." };
  }

  const folderKey = `${uuidv4()}/original.mp4`;

  // Create the DB record first — job appears in queue immediately
  const record = await db.uploadedFile.create({
    data: {
      userId: session.user.id,
      s3Key: folderKey,
      displayName: youtubeUrl,
      youtubeUrl: youtubeUrl,
      uploaded: true,
      clipMode,
      isPreview: previewOnly,
    },
    select: { id: true },
  });

  await sendInngestEvent("process-video-events", {
    uploadedFileId: record.id,
    userId: session.user.id,
    youtubeUrl,
    clipMode,
    previewOnly,
  });

  revalidatePath("/dashboard");
  return { success: true };
}

export async function clearQueueItem(
  fileId: string,
): Promise<{ success: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: "Unauthorized" };

  try {
    const file = await db.uploadedFile.findUniqueOrThrow({
      where: { id: fileId, userId: session.user.id },
    });

    if (file.status === "processing" || file.status === "queued") {
      return { success: false, error: "Cannot clear an active job." };
    }

    await db.uploadedFile.delete({ where: { id: fileId } });

    revalidatePath("/dashboard");
    return { success: true };
  } catch {
    return { success: false, error: "Failed to clear queue item." };
  }
}
