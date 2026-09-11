import { type NextRequest, NextResponse } from "next/server";
import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { getLlmProvider } from "~/server/settings";
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
      // jobType decides WHICH pipeline the retry re-runs (audio vs clip) — the
      // rest lets us rebuild that job's original event instead of a default one.
      jobType: true,
      clipMode: true,
      isPreview: true,
      audioMode: true,
      audioSources: true,
      audioGenre: true,
      audioPrompt: true,
      bedYoutubeUrl: true,
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

  // Reset status and re-fire Inngest events. Clear the previous failure's
  // error text too — otherwise the row shows a fresh "Processing" badge
  // next to a stale error message from the attempt being retried.
  await db.uploadedFile.update({
    where: { id: fileId },
    data: { status: "queued", errorMessage: null, internalErrorDetail: null },
  });

  const llmProvider = await getLlmProvider();
  try {
    if (specificFile.jobType === "audio") {
      // Rebuild the AUDIO job's event (transform strength / duration weren't
      // stored, so they fall back to the mixer's defaults on retry).
      const sources = Array.isArray(specificFile.audioSources)
        ? specificFile.audioSources
        : [];
      await inngest.send({
        name: "process-audio-events",
        data: {
          uploadedFileId: specificFile.id,
          userId: specificFile.userId,
          audioMode: specificFile.audioMode ?? "mashup",
          sources,
          sourceCount: sources.length,
          transformStrength: "auto",
          remixDurationSeconds: 0,
          targetGenre: specificFile.audioGenre ?? "auto",
          prompt: specificFile.audioPrompt ?? "",
          genre: specificFile.audioGenre ?? null,
          llmProvider,
          // Legacy two-URL fields for older mixer code paths.
          ...(specificFile.youtubeUrl ? { vocalUrl: specificFile.youtubeUrl } : {}),
          ...(specificFile.bedYoutubeUrl ? { bedUrl: specificFile.bedYoutubeUrl } : {}),
        },
      });
    } else {
      await inngest.send({
        name: "process-video-events",
        data: {
          uploadedFileId: specificFile.id,
          userId: specificFile.userId,
          ...(specificFile.youtubeUrl
            ? { youtubeUrl: specificFile.youtubeUrl }
            : {}),
          // Keep the job's ORIGINAL mode/preview, not a hardcoded "qa".
          clipMode: specificFile.clipMode ?? "qa",
          previewOnly: specificFile.isPreview ?? false,
          llmProvider,
        },
      });
    }
  } catch (err) {
    console.warn("[reset-stuck-jobs] inngest.send failed (non-fatal):", err);
  }

  return NextResponse.json({
    reset: 1,
    message: `Reset and re-queued the job`,
  });
}
