"use server";

import { v4 as uuidv4 } from "uuid";
import { inngest } from "~/inngest/client";
import { auth } from "~/server/auth";
import { checkConcurrencyLimit } from "~/server/concurrency";
import { db } from "~/server/db";
import { checkUsageLimits } from "~/server/usage";
import type { ActionResult } from "~/types";


/**
 * Fire the processing event. If the queue is unreachable the job is marked
 * failed immediately (with a friendly message) instead of sitting in
 * "queued" forever — the user can retry it from the dashboard.
 */
async function sendProcessEvent(
  uploadedFileId: string,
  data: Record<string, unknown>,
): Promise<boolean> {
  try {
    await inngest.send({ name: "process-video-events", data });
    return true;
  } catch (err) {
    console.error(`[inngest] send failed for ${uploadedFileId}:`, err);
    await db.uploadedFile
      .update({
        where: { id: uploadedFileId },
        data: {
          status: "failed",
          errorMessage:
            "Could not reach the processing queue. Please retry in a moment.",
          internalErrorDetail:
            err instanceof Error ? err.message : String(err),
        },
      })
      .catch(() => undefined);
    return false;
  }
}

export async function processVideo(
  uploadedFileId: string,
  clipMode = "qa",
  previewOnly = false,
  // Read client-side (see uploader.tsx) via the browser's own video
  // metadata — free, instant, and closes the same "duration unknown at
  // gate time" gap the YouTube path had. Without this, the up-front credit
  // gate had nothing but a flat 5-minute guess to check a 4-hour upload
  // against. It's only ever used as an upfront estimate, same as the
  // YouTube duration probe — the actual charge is still based on the real
  // duration Modal measures after processing.
  clientDurationSeconds?: number,
): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return {
      success: false,
      error: "Your session has expired. Please log in again.",
    };
  }

  const uploadedVideo = await db.uploadedFile.findUniqueOrThrow({
    where: { id: uploadedFileId, userId: session.user.id },
    select: { uploaded: true, id: true, userId: true },
  });

  if (uploadedVideo.uploaded) return { success: true };

  const busyError = await checkConcurrencyLimit(session.user.id, uploadedFileId);
  if (busyError) return { success: false, error: busyError };

  const validClientDuration =
    typeof clientDurationSeconds === "number" &&
    Number.isFinite(clientDurationSeconds) &&
    clientDurationSeconds > 0
      ? Math.round(clientDurationSeconds)
      : undefined;

  await db.uploadedFile.update({
    where: { id: uploadedFileId },
    data: {
      uploaded: true,
      clipMode,
      isPreview: previewOnly,
      ...(validClientDuration !== undefined && {
        duration: validClientDuration,
      }),
    },
  });

  const sent = await sendProcessEvent(uploadedVideo.id, {
    uploadedFileId: uploadedVideo.id,
    userId: uploadedVideo.userId,
    clipMode,
    previewOnly,
  });

  // No revalidatePath: the dashboard reads queue/credits from the shared
  // TanStack Query cache, which the client refreshes after this action —
  // revalidating here would force a full-page RSC re-render for data the
  // client already updates in place.
  return sent
    ? { success: true }
    : {
        success: false,
        error:
          "Your video is uploaded, but the processing queue is unreachable. Use Retry on the job in a moment.",
      };
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
): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return {
      success: false,
      error: "Your session has expired. Please log in again.",
    };
  }

  const ytRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+/;
  if (!ytRegex.test(youtubeUrl)) {
    return { success: false, error: "Please enter a valid YouTube URL." };
  }

  // Same server-side gates as direct uploads: credits, daily cap, active jobs.
  const limitError = await checkUsageLimits(session.user.id);
  if (limitError) return { success: false, error: limitError };

  const busyError = await checkConcurrencyLimit(session.user.id);
  if (busyError) return { success: false, error: busyError };

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

  const sent = await sendProcessEvent(record.id, {
    uploadedFileId: record.id,
    userId: session.user.id,
    youtubeUrl,
    clipMode,
    previewOnly,
  });

  return sent
    ? { success: true }
    : {
        success: false,
        error:
          "The video was added, but the processing queue is unreachable. Use Retry on the job in a moment.",
      };
}

export async function clearQueueItem(fileId: string): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return {
      success: false,
      error: "Your session has expired. Please log in again.",
    };
  }

  try {
    const file = await db.uploadedFile.findUniqueOrThrow({
      where: { id: fileId, userId: session.user.id },
    });

    if (file.status === "processing" || file.status === "queued") {
      return { success: false, error: "Cannot clear an active job." };
    }

    await db.uploadedFile.delete({ where: { id: fileId } });

    return { success: true };
  } catch {
    return { success: false, error: "Failed to clear queue item." };
  }
}
