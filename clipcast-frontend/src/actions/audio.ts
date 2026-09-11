"use server";

/**
 * Audio Studio server actions (docs/14): validate input, gate on
 * credits/usage/concurrency, create the job row, and fire the Inngest event the
 * mixer picks up. Two entry points — `createGeneratedTrack` (prompt -> original
 * music) and `createAdvancedMix` / `createMashup` (blend YouTube + uploaded
 * sources) — plus a presigned-upload helper for user-provided audio files.
 */

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { v4 as uuidv4 } from "uuid";
import { env } from "~/env";
import { inngest } from "~/inngest/client";
import { creditsForAudio } from "~/lib/credits";
import { auth } from "~/server/auth";
import { checkConcurrencyLimit } from "~/server/concurrency";
import { db } from "~/server/db";
import { getLlmProvider } from "~/server/settings";
import { checkUsageLimits } from "~/server/usage";
import type { ActionResult } from "~/types";

const YT_REGEX = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+/;
const MAX_MIX_SOURCES = 6;
const MAX_AUDIO_SOURCE_BYTES = 300 * 1024 * 1024;
const ALLOWED_AUDIO_EXTENSIONS = ["mp3", "wav", "m4a", "aac", "flac", "ogg"];
const ALLOWED_AUDIO_CONTENT_TYPES = [
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/mp4",
  "audio/aac",
  "audio/flac",
  "audio/ogg",
];

export type AudioSourceRole = "auto" | "vocal" | "bed" | "extra";
export type MixTransformStrength =
  | "auto"
  | "clean"
  | "subtle"
  | "transformed"
  | "max";
export type AudioSourceInput = {
  id?: string;
  kind: "youtube" | "s3";
  url?: string;
  s3Key?: string;
  label?: string;
  role?: AudioSourceRole;
};

type UploadUrlResult =
  | { success: true; signedUrl: string; key: string }
  | { success: false; error: string };

async function sendAudioEvent(
  uploadedFileId: string,
  data: Record<string, unknown>,
): Promise<boolean> {
  try {
    await inngest.send({ name: "process-audio-events", data });
    return true;
  } catch (err) {
    console.error(`[inngest] audio send failed for ${uploadedFileId}:`, err);
    await db.uploadedFile
      .update({
        where: { id: uploadedFileId },
        data: {
          status: "failed",
          errorMessage:
            "Could not reach the processing queue. Please retry in a moment.",
          internalErrorDetail: err instanceof Error ? err.message : String(err),
        },
      })
      .catch(() => undefined);
    return false;
  }
}

function validateAudioFile(fileInfo: {
  filename: string;
  contentType: string;
  size?: number;
}): string | null {
  const ext = fileInfo.filename.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_AUDIO_EXTENSIONS.includes(ext)) {
    return `Only ${ALLOWED_AUDIO_EXTENSIONS.join(", ").toUpperCase()} audio files are supported.`;
  }
  if (!ALLOWED_AUDIO_CONTENT_TYPES.includes(fileInfo.contentType)) {
    return "That audio file type is not supported.";
  }
  if (
    typeof fileInfo.size === "number" &&
    fileInfo.size > MAX_AUDIO_SOURCE_BYTES
  ) {
    return "That audio file is too large. The maximum size is 300 MB.";
  }
  return null;
}

function cleanSource(
  source: AudioSourceInput,
  userId: string,
  index: number,
): AudioSourceInput | null {
  const role: AudioSourceRole = source.role ?? "auto";
  const base = {
    id: source.id?.trim() || `src-${index + 1}`,
    label: source.label?.trim().slice(0, 80) || `Source ${index + 1}`,
    role,
  };

  if (source.kind === "youtube") {
    const url = source.url?.trim() ?? "";
    if (!YT_REGEX.test(url)) return null;
    return { ...base, kind: "youtube", url };
  }

  const s3Key = source.s3Key?.trim() ?? "";
  if (!s3Key.startsWith(`audio-sources/${userId}/`)) return null;
  return { ...base, kind: "s3", s3Key };
}

export async function generateAudioSourceUploadUrl(fileInfo: {
  filename: string;
  contentType: string;
  size?: number;
}): Promise<UploadUrlResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: "Your session has expired. Please log in again." };
  }

  const fileError = validateAudioFile(fileInfo);
  if (fileError) return { success: false, error: fileError };

  const limitError = await checkUsageLimits(session.user.id);
  if (limitError) return { success: false, error: limitError };

  try {
    const s3Client = new S3Client({
      region: env.AWS_REGION,
      credentials: {
        accessKeyId: env.AWS_ACCESS_KEY_ID,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
      },
    });

    const fileExtension = fileInfo.filename.split(".").pop()?.toLowerCase() ?? "mp3";
    const key = `audio-sources/${session.user.id}/${uuidv4()}/original.${fileExtension}`;
    const command = new PutObjectCommand({
      Bucket: env.S3_BUCKET_NAME,
      Key: key,
      ContentType: fileInfo.contentType,
    });
    // Presigned PUT: the browser uploads straight to S3, so large audio files
    // never pass through the Next.js server. 10800s (3h) of headroom for slow
    // connections, matching the video-upload URL in ~/actions/s3.
    const signedUrl = await getSignedUrl(s3Client, command, { expiresIn: 10800 });
    return { success: true, signedUrl, key };
  } catch (err) {
    console.error("[audio] generateAudioSourceUploadUrl failed:", err);
    return {
      success: false,
      error: "Could not prepare the audio upload. Please try again.",
    };
  }
}

/**
 * Advanced mix: one or more YouTube/audio-file sources. The backend auto-detects
 * which source should provide vocals, which should provide the bed, and which
 * extra sources can be layered quietly.
 */
export async function createAdvancedMix(
  rawSources: AudioSourceInput[],
  transformStrength: MixTransformStrength = "auto",
  remixDurationSeconds = 0,
  targetGenre = "auto",
): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: "Your session has expired. Please log in again." };
  }

  // 0 = let the mixer decide the length musically. Any explicit request is
  // clamped to a viral 8-59s so we never render a long video.
  const requested = Math.round(remixDurationSeconds) || 0;
  const clampedDuration = requested > 0 ? Math.min(59, Math.max(8, requested)) : 0;

  const sources = rawSources
    .slice(0, MAX_MIX_SOURCES)
    .map((source, index) => cleanSource(source, session.user.id, index))
    .filter((source): source is AudioSourceInput => Boolean(source));

  if (sources.length === 0) {
    return { success: false, error: "Add at least one YouTube link or audio file." };
  }

  const limitError = await checkUsageLimits(session.user.id);
  if (limitError) return { success: false, error: limitError };

  const busyError = await checkConcurrencyLimit(session.user.id);
  if (busyError) return { success: false, error: busyError };

  const requiredCredits = creditsForAudio("mashup", sources.length);
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { credits: true },
  });
  if ((user?.credits ?? 0) < requiredCredits) {
    return {
      success: false,
      error: `This mix needs ${requiredCredits} credits. Add credits or remove a source.`,
    };
  }

  const youtubeSources = sources.filter((source) => source.kind === "youtube");
  const record = await db.uploadedFile.create({
    data: {
      userId: session.user.id,
      s3Key: `audio/${uuidv4()}/`,
      displayName: `AI mix (${sources.length} source${sources.length === 1 ? "" : "s"})`,
      jobType: "audio",
      audioMode: "mashup",
      // Audio jobs are NOT clip jobs — null out the clip-mode default ("qa") so
      // it can never leak into the audio UI.
      clipMode: null,
      audioGenre: targetGenre !== "auto" ? targetGenre : null,
      youtubeUrl: youtubeSources[0]?.url ?? null,
      bedYoutubeUrl: youtubeSources[1]?.url ?? null,
      audioSources: sources,
      uploaded: true,
    },
    select: { id: true },
  });

  const sent = await sendAudioEvent(record.id, {
    uploadedFileId: record.id,
    userId: session.user.id,
    audioMode: "mashup",
    sources,
    sourceCount: sources.length,
    transformStrength,
    remixDurationSeconds: clampedDuration,
    targetGenre,
    llmProvider: await getLlmProvider(),
    // Legacy fields keep older queue/mixer code paths usable.
    vocalUrl: youtubeSources[0]?.url,
    bedUrl: youtubeSources[1]?.url,
  });
  return sent
    ? { success: true }
    : {
        success: false,
        error:
          "The mix was added, but the processing queue is unreachable. Use Retry in a moment.",
      };
}

/**
 * Compatibility wrapper for the old two-URL UI/API.
 */
export async function createMashup(
  vocalUrl: string,
  bedUrl: string,
): Promise<ActionResult> {
  return createAdvancedMix(
    [
      { kind: "youtube", url: vocalUrl, role: "vocal", label: "Vocal track" },
      { kind: "youtube", url: bedUrl, role: "bed", label: "Beat track" },
    ],
    "auto",
    0,
  );
}

/**
 * Generate an original track from a text prompt + genre preset. No YouTube
 * input; the mixer runs the music model directly.
 */
export async function createGeneratedTrack(
  prompt: string,
  genre?: string,
): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: "Your session has expired. Please log in again." };
  }
  if (!prompt.trim() && !genre) {
    return { success: false, error: "Describe the music you want, or pick a genre." };
  }

  const limitError = await checkUsageLimits(session.user.id);
  if (limitError) return { success: false, error: limitError };

  const busyError = await checkConcurrencyLimit(session.user.id);
  if (busyError) return { success: false, error: busyError };

  const requiredCredits = creditsForAudio("generate");
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { credits: true },
  });
  if ((user?.credits ?? 0) < requiredCredits) {
    return {
      success: false,
      error: `Composing a track needs ${requiredCredits} credit${requiredCredits === 1 ? "" : "s"}. Add credits and try again.`,
    };
  }

  const record = await db.uploadedFile.create({
    data: {
      userId: session.user.id,
      s3Key: `audio/${uuidv4()}/`,
      displayName: prompt.trim().slice(0, 80) || `${genre ?? "Generated"} track`,
      jobType: "audio",
      audioMode: "generate",
      clipMode: null, // not a clip job — never show a clip mode
      audioPrompt: prompt.trim() || null,
      audioGenre: genre ?? null,
      uploaded: true,
    },
    select: { id: true },
  });

  const sent = await sendAudioEvent(record.id, {
    uploadedFileId: record.id,
    userId: session.user.id,
    audioMode: "generate",
    prompt: prompt.trim(),
    genre: genre ?? null,
    llmProvider: await getLlmProvider(),
  });
  return sent
    ? { success: true }
    : {
        success: false,
        error:
          "The track was added, but the processing queue is unreachable. Use Retry in a moment.",
      };
}
