"use server";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { revalidatePath } from "next/cache";
import { env } from "~/env";
import { auth } from "~/server/auth";
import { db } from "~/server/db";
import type { ActionResult, ClipGroup } from "~/types";

function s3Client() {
  return new S3Client({
    region: env.AWS_REGION,
    credentials: {
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    },
  });
}

type ClipUrlResult =
  | { success: true; url: string }
  | { success: false; error: string };

/**
 * Presigned GET URL for a clip the user owns. `download: true` forces the
 * browser to save the file instead of playing it inline.
 */
export async function getClipUrl(
  clipId: string,
  download = false,
): Promise<ClipUrlResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return {
      success: false,
      error: "Your session has expired. Please log in again.",
    };
  }

  const clip = await db.clip.findUnique({
    where: { id: clipId, userId: session.user.id },
    select: { s3Key: true },
  });
  if (!clip) return { success: false, error: "Clip not found." };

  try {
    const filename = clip.s3Key.split("/").pop() ?? "clip.mp4";
    const command = new GetObjectCommand({
      Bucket: env.S3_BUCKET_NAME,
      Key: clip.s3Key,
      ...(download
        ? {
            ResponseContentDisposition: `attachment; filename="${filename}"`,
          }
        : {}),
    });
    const url = await getSignedUrl(s3Client(), command, { expiresIn: 3600 });
    return { success: true, url };
  } catch (err) {
    console.error("[clips] getClipUrl failed:", err);
    return {
      success: false,
      error: "Could not reach storage. Please try again in a moment.",
    };
  }
}

/**
 * Presigned GET URLs for a batch of the caller's own clips' thumbnails.
 * Clips with no `thumbnailS3Key` (rendered before this feature existed) are
 * skipped — the UI falls back to a placeholder for those.
 */
export async function getClipThumbnailUrls(
  clipIds: string[],
): Promise<Record<string, string>> {
  const session = await auth();
  if (!session?.user?.id || clipIds.length === 0) return {};

  const clips = await db.clip.findMany({
    where: { id: { in: clipIds }, userId: session.user.id, thumbnailS3Key: { not: null } },
    select: { id: true, thumbnailS3Key: true },
  });

  const client = s3Client();
  const entries = await Promise.all(
    clips.map(async (clip) => {
      try {
        const url = await getSignedUrl(
          client,
          new GetObjectCommand({ Bucket: env.S3_BUCKET_NAME, Key: clip.thumbnailS3Key! }),
          { expiresIn: 3600 },
        );
        return [clip.id, url] as const;
      } catch (err) {
        console.error("[clips] getClipThumbnailUrls failed for", clip.id, err);
        return null;
      }
    }),
  );

  return Object.fromEntries(entries.filter((e): e is readonly [string, string] => e !== null));
}


/** Human "Title Case" clip name derived from its S3 key, for clips rendered
 * before AI titles existed. */
function clipTitle(s3Key: string, clipMode: string): string {
  const base = s3Key.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "Clip";
  const pretty = base.replace(/[_-]+/g, " ").trim();
  return pretty.length > 1
    ? pretty.charAt(0).toUpperCase() + pretty.slice(1)
    : `${clipMode} clip`;
}

function relativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// Source groups per Clips page. Local (not exported) because a "use server"
// module may only export async functions; the grid falls back to the same 8.
const CLIP_GROUPS_PAGE_SIZE = 8;

/**
 * One page of clip groups (source videos), newest source first. Paginated by
 * source so opening the Clips page never loads every clip at once, and NO
 * thumbnails are presigned here — the grid fetches a group's thumbnails lazily
 * via `getClipThumbnailUrls` only when that group is expanded.
 */
export async function getClipGroups(
  page = 1,
  pageSize = CLIP_GROUPS_PAGE_SIZE,
  // "clip" = video clip jobs (the Clips page); "audio" = Audio Studio outputs.
  // Keeps the two kinds of output on their own pages, never mixed.
  kind: "clip" | "audio" = "clip",
): Promise<{ groups: ClipGroup[]; total: number; pageSize: number }> {
  const session = await auth();
  if (!session?.user?.id) return { groups: [], total: 0, pageSize };

  // Clips cascade-delete with their source, so every clip has a source here —
  // grouping by UploadedFile is exhaustive. Audio jobs have jobType "audio";
  // clip jobs have "clip" or null (legacy).
  const where = {
    userId: session.user.id,
    clips: { some: {} },
    ...(kind === "audio"
      ? { jobType: "audio" }
      : { jobType: { not: "audio" } }),
  };
  const [files, total] = await Promise.all([
    db.uploadedFile.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (Math.max(1, page) - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        displayName: true,
        clips: {
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            s3Key: true,
            clipMode: true,
            isPreview: true,
            title: true,
            duration: true,
            createdAt: true,
            youtubeVideoId: true,
            mediaType: true,
          },
        },
      },
    }),
    db.uploadedFile.count({ where }),
  ]);

  const groups: ClipGroup[] = files.map((file) => ({
    id: file.id,
    title: file.displayName ?? "Untitled source",
    clips: file.clips.map((clip) => ({
      id: clip.id,
      title: clip.title ?? clipTitle(clip.s3Key, clip.clipMode),
      clipMode: clip.clipMode,
      isPreview: clip.isPreview,
      duration: clip.duration,
      // Presigned on demand when the group expands (see getClipThumbnailUrls).
      thumbnailUrl: null,
      createdAt: relativeTime(clip.createdAt),
      youtubeVideoId: clip.youtubeVideoId,
      mediaType: clip.mediaType,
    })),
  }));

  return { groups, total, pageSize };
}

/** Delete a clip: removes the S3 object (best-effort) and the DB record. */
export async function deleteClip(clipId: string): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return {
      success: false,
      error: "Your session has expired. Please log in again.",
    };
  }

  const clip = await db.clip.findUnique({
    where: { id: clipId, userId: session.user.id },
    select: { id: true, s3Key: true },
  });
  if (!clip) return { success: false, error: "Clip not found." };

  try {
    await s3Client()
      .send(
        new DeleteObjectCommand({
          Bucket: env.S3_BUCKET_NAME,
          Key: clip.s3Key,
        }),
      )
      .catch((err) => {
        // S3 cleanup is best-effort; the DB record is the source of truth.
        console.warn("[clips] S3 delete failed for", clip.s3Key, err);
      });

    await db.clip.delete({ where: { id: clip.id } });

    revalidatePath("/dashboard/clips");
    revalidatePath("/dashboard");
    return { success: true };
  } catch (err) {
    console.error("[clips] deleteClip failed:", err);
    return { success: false, error: "Could not delete the clip." };
  }
}
