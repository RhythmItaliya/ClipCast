import { redirect } from "next/navigation";
import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { YouTubeChannelClient } from "~/components/youtube-channel-client";
import type { PendingYouTubeChannel } from "~/actions/youtube";

export default async function YouTubePage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string; select_channel?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const params = await searchParams;

  let isConnected = false;
  let channelName: string | null = null;
  let pendingChannels: PendingYouTubeChannel[] = [];

  try {
    const user = await db.user.findUnique({
      where: { id: session.user.id },
      select: {
        youtubeChannelId: true,
        youtubeChannelName: true,
        youtubePendingChannels: true,
      },
    });
    isConnected = !!user?.youtubeChannelId;
    channelName = user?.youtubeChannelName ?? null;
    pendingChannels = Array.isArray(user?.youtubePendingChannels)
      ? (user.youtubePendingChannels as unknown as PendingYouTubeChannel[])
      : [];
  } catch (e) {
    // Stale Prisma client during hot-reload — show disconnected state
    console.error("[youtube/page] DB query failed (restart dev server):", e);
  }

  return (
    <YouTubeChannelClient
      isConnected={isConnected}
      channelName={channelName}
      connected={params.connected === "true"}
      oauthError={params.error ?? null}
      pendingChannels={pendingChannels}
    />
  );
}
