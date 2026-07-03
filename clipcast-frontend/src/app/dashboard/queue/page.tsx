import { redirect } from "next/navigation";
import { QueueTable } from "~/components/dashboard/queue-table";
import { auth } from "~/server/auth";
import { db } from "~/server/db";

export const metadata = {
  title: "Queue — ClipCast",
  description:
    "Track processing jobs, retries, and generated clips across your workspace.",
};

export default async function QueuePage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const files = await db.uploadedFile.findMany({
    where: { userId: session.user.id, uploaded: true },
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
      _count: { select: { clips: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const queueFiles = files.map((file) => ({
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

  return <QueueTable initialFiles={queueFiles} />;
}
