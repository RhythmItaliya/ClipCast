import type { Prisma } from "@prisma/client";
import type { QueueFile } from "~/types";
import { db } from "~/server/db";

/** Shared shape for every place that renders a `QueueTable` (dashboard
 * overview, the queue page, and the polled `/api/queue-status` route) so the
 * select list and the row-to-UI mapping only exist once. */
export const QUEUE_FILE_SELECT = {
  id: true,
  s3Key: true,
  displayName: true,
  youtubeUrl: true,
  // Audio mashups have MORE than one source — the extra YouTube/bed URLs so the
  // queue row can open every source, not just the first.
  bedYoutubeUrl: true,
  audioSources: true,
  status: true,
  // jobType + audioMode so the row shows the AUDIO mode for audio jobs instead
  // of the clip-mode default ("qa").
  jobType: true,
  audioMode: true,
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

/** Every YouTube source URL for a job — all sources of an audio mashup, or the
 * single link for a clip job. Used to open each source in its own tab. */
function extractSourceUrls(file: QueueFileRow): string[] {
  const urls: string[] = [];
  const sources = Array.isArray(file.audioSources) ? file.audioSources : [];
  for (const source of sources) {
    if (
      source &&
      typeof source === "object" &&
      "kind" in source &&
      source.kind === "youtube" &&
      "url" in source &&
      typeof source.url === "string" &&
      source.url
    ) {
      urls.push(source.url);
    }
  }
  // Clip jobs (and legacy audio) don't use audioSources — fall back to the
  // vocal + bed URLs.
  if (urls.length === 0) {
    if (file.youtubeUrl) urls.push(file.youtubeUrl);
    if (file.bedYoutubeUrl) urls.push(file.bedYoutubeUrl);
  }
  return urls;
}

export function toQueueFile(file: QueueFileRow): QueueFile {
  return {
    id: file.id,
    s3Key: file.s3Key,
    filename: file.displayName ?? "Unknown filename",
    youtubeUrl: file.youtubeUrl,
    sourceUrls: extractSourceUrls(file),
    jobType: file.jobType ?? "clip",
    audioMode: file.audioMode ?? null,
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
