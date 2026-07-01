import { NextResponse } from "next/server";
import { auth } from "~/server/auth";
import { db } from "~/server/db";

export async function GET() {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userData = await db.user.findUnique({
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
  });

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
    clipsCount: file._count.clips,
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
  }));

  return NextResponse.json({
    uploadedFiles: formattedFiles,
  });
}
