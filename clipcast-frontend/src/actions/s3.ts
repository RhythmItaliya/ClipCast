"use server";

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { v4 as uuidv4 } from "uuid";
import { env } from "~/env";
import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { checkUsageLimits, validateUploadFile } from "~/server/usage";

type UploadUrlResult =
  | {
      success: true;
      signedUrl: string;
      key: string;
      uploadedFileId: string;
    }
  | { success: false; error: string };

export async function generateUploadUrl(fileInfo: {
  filename: string;
  contentType: string;
  size?: number;
}): Promise<UploadUrlResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: "Your session has expired. Please log in again." };
  }

  // Server-side validation — the client mirrors these but is never trusted.
  const fileError = validateUploadFile(fileInfo);
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

    const fileExtension = fileInfo.filename.split(".").pop() ?? "";

    const uniqueId = uuidv4();
    const key = `${uniqueId}/original.${fileExtension}`;

    const command = new PutObjectCommand({
      Bucket: env.S3_BUCKET_NAME,
      Key: key,
      ContentType: fileInfo.contentType,
    });

    const signedUrl = await getSignedUrl(s3Client, command, {
      expiresIn: 600,
    });

    const uploadedFileDbRecord = await db.uploadedFile.create({
      data: {
        userId: session.user.id,
        s3Key: key,
        displayName: fileInfo.filename,
        uploaded: false,
      },
      select: {
        id: true,
      },
    });

    return {
      success: true,
      signedUrl,
      key,
      uploadedFileId: uploadedFileDbRecord.id,
    };
  } catch (err) {
    console.error("[s3] generateUploadUrl failed:", err);
    return {
      success: false,
      error:
        "Could not prepare the upload — our storage service didn't respond. Please try again.",
    };
  }
}
