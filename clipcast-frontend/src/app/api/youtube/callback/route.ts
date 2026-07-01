import { NextResponse } from "next/server";
import { env } from "~/env";
import { db } from "~/server/db";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const userId = url.searchParams.get("state"); // passed via OAuth state param
  const error = url.searchParams.get("error");

  if (error || !code || !userId) {
    return NextResponse.redirect(
      `${env.BASE_URL}/dashboard/youtube?error=oauth_failed`,
    );
  }

  try {
    // Exchange code for tokens
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID!,
        client_secret: env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: `${env.BASE_URL}/api/youtube/callback`,
        grant_type: "authorization_code",
        code,
      }),
    });

    if (!tokenRes.ok) {
      throw new Error(`Token exchange failed: ${tokenRes.status}`);
    }

    const tokens = (await tokenRes.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    };

    // Fetch the user's YouTube channel info
    const channelRes = await fetch(
      "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",
      { headers: { Authorization: `Bearer ${tokens.access_token}` } },
    );

    const channelData = (await channelRes.json()) as {
      items?: { id: string; snippet: { title: string } }[];
    };

    const channel = channelData.items?.[0];
    if (!channel) throw new Error("No YouTube channel found for this account");

    const expiry = new Date(Date.now() + tokens.expires_in * 1000);

    await db.user.update({
      where: { id: userId },
      data: {
        youtubeChannelId: channel.id,
        youtubeChannelName: channel.snippet.title,
        youtubeAccessToken: tokens.access_token,
        youtubeRefreshToken: tokens.refresh_token ?? null,
        youtubeTokenExpiry: expiry,
      },
    });

    return NextResponse.redirect(
      `${env.BASE_URL}/dashboard/youtube?connected=true`,
    );
  } catch (err) {
    console.error("[youtube/callback] error:", err);
    let errorMessage = "connection_failed";

    if (err instanceof Error) {
      if (err.message.includes("No YouTube channel found")) {
        errorMessage = "no_channel";
      } else if (err.message.includes("Token exchange failed")) {
        errorMessage = "oauth_failed";
      }
    }

    return NextResponse.redirect(
      `${env.BASE_URL}/dashboard/youtube?error=${errorMessage}`,
    );
  }
}
