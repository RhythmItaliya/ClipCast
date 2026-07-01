import { redirect } from "next/navigation";
import { DashboardClient } from "~/components/dashboard-client";
import { auth } from "~/server/auth";
import { db } from "~/server/db";

export default async function DashboardPage() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
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
    redirect("/login");
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

  return <DashboardClient uploadedFiles={formattedFiles} />;
}
