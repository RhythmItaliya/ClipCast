"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { env } from "~/env";
import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { YOUTUBE_TOKEN_REFRESH_THRESHOLD_MS } from "~/lib/utils";

export type PendingYouTubeChannel = { id: string; title: string };

// ── OAuth helpers ────────────────────────────────────────────────────────────
const SCOPES = [
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/userinfo.profile",
].join(" ");

export async function getYouTubeAuthUrl(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Your session has expired. Please log in again.");

  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw new Error(
      "YouTube channel integration is not configured yet. Please contact support.",
    );
  }

  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID!,
    redirect_uri: `${env.BASE_URL}/api/youtube/callback`,
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",
    prompt: "consent",
    state: session.user.id, // pass userId so callback can match it
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function disconnectYouTubeChannel(): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Your session has expired. Please log in again.");

  await db.user.update({
    where: { id: session.user.id },
    data: {
      youtubeChannelId: null,
      youtubeChannelName: null,
      youtubeAccessToken: null,
      youtubeRefreshToken: null,
      youtubeTokenExpiry: null,
      youtubePendingChannels: Prisma.JsonNull,
    },
  });

  revalidatePath("/dashboard/youtube");
}

/**
 * Finalizes the channel a user picked when their Google account had more
 * than one and the OAuth callback parked them in a "select channel" state
 * (tokens already saved, candidates in youtubePendingChannels).
 */
export async function selectYouTubeChannel(
  channelId: string,
): Promise<{ success: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: "Your session has expired. Please log in again." };
  }

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { youtubePendingChannels: true },
  });

  const pending = Array.isArray(user?.youtubePendingChannels)
    ? (user.youtubePendingChannels as unknown as PendingYouTubeChannel[])
    : [];
  const picked = pending.find((c) => c.id === channelId);

  if (!picked) {
    return {
      success: false,
      error: "That channel is no longer available. Please reconnect your account.",
    };
  }

  await db.user.update({
    where: { id: session.user.id },
    data: {
      youtubeChannelId: picked.id,
      youtubeChannelName: picked.title,
      youtubePendingChannels: Prisma.JsonNull,
    },
  });

  revalidatePath("/dashboard/youtube");
  return { success: true };
}

// ── Refresh token if expired ─────────────────────────────────────────────────
async function refreshAccessToken(userId: string, refreshToken: string) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID!,
      client_secret: env.GOOGLE_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) throw new Error("Your YouTube connection has expired. Please disconnect and reconnect your channel.");

  const data = (await res.json()) as {
    access_token: string;
    expires_in: number;
  };

  const expiry = new Date(Date.now() + data.expires_in * 1000);
  await db.user.update({
    where: { id: userId },
    data: {
      youtubeAccessToken: data.access_token,
      youtubeTokenExpiry: expiry,
    },
  });

  return data.access_token;
}

async function getValidAccessToken(userId: string): Promise<string | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      youtubeAccessToken: true,
      youtubeRefreshToken: true,
      youtubeTokenExpiry: true,
    },
  });

  if (!user?.youtubeAccessToken || !user.youtubeRefreshToken) return null;

  // Refresh if within 5 minutes of expiry
  const needsRefresh =
    !user.youtubeTokenExpiry ||
    user.youtubeTokenExpiry.getTime() <
      Date.now() + YOUTUBE_TOKEN_REFRESH_THRESHOLD_MS;

  if (needsRefresh) {
    return await refreshAccessToken(userId, user.youtubeRefreshToken);
  }

  return user.youtubeAccessToken;
}

// ── Channel videos ───────────────────────────────────────────────────────────
export type YouTubeVideo = {
  id: string;
  title: string;
  description: string;
  thumbnailUrl: string;
  publishedAt: string;
  duration: string;
  viewCount: string;
  url: string;
};

export async function getChannelVideos(
  maxResults = 12,
): Promise<{ success: boolean; videos?: YouTubeVideo[]; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: "Unauthorized" };

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { youtubeChannelId: true, youtubeAccessToken: true },
  });

  if (!user?.youtubeChannelId) {
    return { success: false, error: "No YouTube channel connected." };
  }

  try {
    const accessToken = await getValidAccessToken(session.user.id);
    if (!accessToken) {
      return { success: false, error: "YouTube access token unavailable." };
    }

    // Get uploads playlist ID
    const channelRes = await fetch(
      `https://www.googleapis.com/youtube/v3/channels?part=contentDetails&mine=true`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    const channelData = (await channelRes.json()) as {
      items?: {
        contentDetails?: { relatedPlaylists?: { uploads?: string } };
      }[];
    };

    const uploadsPlaylistId =
      channelData.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
    if (!uploadsPlaylistId) {
      return { success: false, error: "Could not find uploads playlist." };
    }

    // List videos from uploads playlist
    const playlistRes = await fetch(
      `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${uploadsPlaylistId}&maxResults=${maxResults}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    const playlistData = (await playlistRes.json()) as {
      items?: {
        snippet: {
          publishedAt: string;
          title: string;
          description: string;
          thumbnails: { medium?: { url: string } };
          resourceId: { videoId: string };
        };
      }[];
    };

    const videoIds =
      playlistData.items?.map((i) => i.snippet.resourceId.videoId).join(",") ??
      "";

    // Get video details (duration, views)
    const detailsRes = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=contentDetails,statistics&id=${videoIds}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    const detailsData = (await detailsRes.json()) as {
      items?: {
        id: string;
        contentDetails: { duration: string };
        statistics: { viewCount: string };
      }[];
    };

    const detailsMap = new Map(
      detailsData.items?.map((v) => [
        v.id,
        {
          duration: v.contentDetails.duration,
          viewCount: v.statistics.viewCount,
        },
      ]),
    );

    const videos: YouTubeVideo[] =
      playlistData.items?.map((item) => {
        const videoId = item.snippet.resourceId.videoId;
        const details = detailsMap.get(videoId);
        return {
          id: videoId,
          title: item.snippet.title,
          description: item.snippet.description,
          thumbnailUrl: item.snippet.thumbnails.medium?.url ?? "",
          publishedAt: item.snippet.publishedAt,
          duration: formatISODuration(details?.duration ?? "PT0S"),
          viewCount: formatCount(details?.viewCount ?? "0"),
          url: `https://www.youtube.com/watch?v=${videoId}`,
        };
      }) ?? [];

    return { success: true, videos };
  } catch (err) {
    console.error("[youtube] getChannelVideos error:", err);
    return { success: false, error: "Failed to load channel videos." };
  }
}

// ── Formatters ───────────────────────────────────────────────────────────────
function formatISODuration(iso: string): string {
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return "0:00";
  const h = parseInt(match[1] ?? "0");
  const m = parseInt(match[2] ?? "0");
  const s = parseInt(match[3] ?? "0");
  if (h > 0)
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatCount(count: string): string {
  const n = parseInt(count);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
