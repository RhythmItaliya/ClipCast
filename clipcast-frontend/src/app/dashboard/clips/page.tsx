import { redirect } from "next/navigation";
import { getClipGroups } from "~/actions/clips";
import { ClipsGrid } from "~/components/dashboard/clips-grid";
import { auth } from "~/server/auth";
import { db } from "~/server/db";

export const metadata = {
  title: "Clips — ClipCast",
  description:
    "Browse, download and delete every clip generated from your podcasts.",
};

export default async function ClipsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const { page: pageParam } = await searchParams;
  const page = Math.max(1, parseInt(pageParam ?? "1", 10) || 1);

  // Only a bounded page of groups is fetched, and thumbnails are presigned
  // lazily per group as it's expanded — the page open no longer loads every
  // clip or signs every thumbnail.
  const [{ groups, total, pageSize }, user] = await Promise.all([
    getClipGroups(page),
    db.user.findUnique({
      where: { id: session.user.id },
      select: { youtubeChannelId: true },
    }),
  ]);

  return (
    <ClipsGrid
      groups={groups}
      youtubeConnected={!!user?.youtubeChannelId}
      page={page}
      pageSize={pageSize}
      total={total}
    />
  );
}
