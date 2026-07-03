import { redirect } from "next/navigation";
import { ClipsGrid, type ClipGroup } from "~/components/dashboard/clips-grid";
import { auth } from "~/server/auth";
import { db } from "~/server/db";

export const metadata = {
  title: "Clips — ClipCast",
  description:
    "Browse, download and delete every clip generated from your podcasts.",
};

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

export default async function ClipsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const clips = await db.clip.findMany({
    where: { userId: session.user.id },
    select: {
      id: true,
      s3Key: true,
      clipMode: true,
      isPreview: true,
      createdAt: true,
      uploadedFileId: true,
      uploadedFile: { select: { displayName: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  // Group clips by their source video, newest source first.
  const groups: ClipGroup[] = [];
  const byId = new Map<string, ClipGroup>();
  for (const clip of clips) {
    const key = clip.uploadedFileId ?? "orphaned";
    let group = byId.get(key);
    if (!group) {
      group = {
        id: key,
        title: clip.uploadedFile?.displayName ?? "Deleted source video",
        clips: [],
      };
      byId.set(key, group);
      groups.push(group);
    }
    group.clips.push({
      id: clip.id,
      title: clipTitle(clip.s3Key, clip.clipMode),
      clipMode: clip.clipMode,
      isPreview: clip.isPreview,
      createdAt: relativeTime(clip.createdAt),
    });
  }

  return <ClipsGrid groups={groups} />;
}
