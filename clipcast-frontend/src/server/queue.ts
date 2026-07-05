import type { Prisma } from "@prisma/client";
import type { QueueFile } from "~/components/dashboard/queue-table";
import { db } from "~/server/db";

/** Shared shape for every place that renders a `QueueTable` (dashboard
 * overview, the queue page, and the polled `/api/queue-status` route) so the
 * select list and the row-to-UI mapping only exist once. */
export const QUEUE_FILE_SELECT = {
  id: true,
  s3Key: true,
  displayName: true,
  youtubeUrl: true,
  status: true,
  clipMode: true,
  isPreview: true,
  errorMessage: true,
  processingSummary: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { clips: true } },
} satisfies Prisma.UploadedFileSelect;

type QueueFileRow = Prisma.UploadedFileGetPayload<{
  select: typeof QUEUE_FILE_SELECT;
}>;

export function toQueueFile(file: QueueFileRow): QueueFile {
  return {
    id: file.id,
    s3Key: file.s3Key,
    filename: file.displayName ?? "Unknown filename",
    youtubeUrl: file.youtubeUrl,
    status: file.status,
    clipMode: file.clipMode,
    isPreview: file.isPreview,
    errorMessage: file.errorMessage ?? null,
    processingSummary: file.processingSummary ?? null,
    clipsCount: file._count.clips,
    createdAt: file.createdAt.toISOString(),
    updatedAt: file.updatedAt.toISOString(),
  };
}

export async function getQueueFiles(userId: string): Promise<QueueFile[]> {
  const files = await db.uploadedFile.findMany({
    where: { userId, uploaded: true },
    select: QUEUE_FILE_SELECT,
    orderBy: { createdAt: "desc" },
  });
  return files.map(toQueueFile);
}
