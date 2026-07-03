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

type ActionResult = { success: boolean; error?: string };

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
