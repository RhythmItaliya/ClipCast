import { redirect } from "next/navigation";
import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { YouTubeChannelClient } from "~/components/youtube-channel-client";

export default async function YouTubePage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const params = await searchParams;

  let isConnected = false;
  let channelName: string | null = null;

  try {
    const user = await db.user.findUnique({
      where: { id: session.user.id },
      select: {
        youtubeChannelId: true,
        youtubeChannelName: true,
      },
    });
    isConnected = !!user?.youtubeChannelId;
    channelName = user?.youtubeChannelName ?? null;
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
    />
  );
}
