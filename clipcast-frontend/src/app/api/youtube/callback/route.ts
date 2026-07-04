import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { env } from "~/env";
import { auth } from "~/server/auth";
import { db } from "~/server/db";

/**
 * Carries a specific redirect code so the frontend shows an honest message
 * instead of guessing. In particular, "no_channel" must only ever mean the
 * Google API actually returned zero channels for the account — a failed
 * lookup (API not enabled, quota, transient error) is a different code
 * ("api_error"), because telling a user with a real channel that they have
 * no channel is actively misleading and unactionable.
 */
class YouTubeConnectError extends Error {
  readonly code: "oauth_failed" | "no_channel" | "api_error";
  constructor(code: "oauth_failed" | "no_channel" | "api_error", message: string) {
    super(message);
    this.name = "YouTubeConnectError";
    this.code = code;
  }
}

export async function GET(req: Request) {
  const session = await auth();
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state"); // must match the initiating user's session
  const error = url.searchParams.get("error");

  if (error || !code || !state) {
    return NextResponse.redirect(
      `${env.BASE_URL}/dashboard/youtube?error=oauth_failed`,
    );
  }

  // The state must match the session completing this callback — otherwise
  // someone could point another user's browser at this URL with their own
  // authorization code and a guessed/leaked state value to attach their
  // YouTube tokens to a victim's ClipCast account.
  if (!session?.user?.id || session.user.id !== state) {
    return NextResponse.redirect(
      `${env.BASE_URL}/dashboard/youtube?error=oauth_failed`,
    );
  }
  const userId = session.user.id;

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
      const body = await tokenRes.text().catch(() => "");
      throw new YouTubeConnectError(
        "oauth_failed",
        `Token exchange failed (HTTP ${tokenRes.status}): ${body.slice(0, 500)}`,
      );
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
    const channelBody = await channelRes.text();

    // A non-2xx response means the lookup itself failed (API not enabled on
    // the Google Cloud project, quota exceeded, transient error) — NOT that
    // the account has no channel. Conflating the two is exactly what made
    // this show "No Channel Found" for accounts that do have one.
    if (!channelRes.ok) {
      throw new YouTubeConnectError(
        "api_error",
        `Channel lookup failed (HTTP ${channelRes.status}): ${channelBody.slice(0, 500)}`,
      );
    }

    let channelData: { items?: { id: string; snippet: { title: string } }[] };
    try {
      channelData = JSON.parse(channelBody) as typeof channelData;
    } catch {
      throw new YouTubeConnectError(
        "api_error",
        `Channel lookup returned unparsable JSON: ${channelBody.slice(0, 500)}`,
      );
    }

    const channels = channelData.items ?? [];
    if (channels.length === 0) {
      throw new YouTubeConnectError(
        "no_channel",
        "Channel lookup succeeded but returned zero channels for this account.",
      );
    }

    const expiry = new Date(Date.now() + tokens.expires_in * 1000);
    const tokenFields = {
      youtubeAccessToken: tokens.access_token,
      youtubeRefreshToken: tokens.refresh_token ?? null,
      youtubeTokenExpiry: expiry,
    };

    if (channels.length === 1) {
      // Only one channel on this account — nothing to pick, connect it
      // directly, same as before.
      await db.user.update({
        where: { id: userId },
        data: {
          youtubeChannelId: channels[0]!.id,
          youtubeChannelName: channels[0]!.snippet.title,
          youtubePendingChannels: Prisma.JsonNull,
          ...tokenFields,
        },
      });
      return NextResponse.redirect(
        `${env.BASE_URL}/dashboard/youtube?connected=true`,
      );
    }

    // Some Google accounts manage more than one channel (legacy
    // multi-channel accounts, or several Brand Accounts). `mine=true`
    // returns all of them rather than the one the user actually meant to
    // connect, so save the tokens now and let them pick which channel
    // before we commit one as "the" connected channel.
    await db.user.update({
      where: { id: userId },
      data: {
        youtubePendingChannels: channels.map((c) => ({
          id: c.id,
          title: c.snippet.title,
        })),
        ...tokenFields,
      },
    });
    return NextResponse.redirect(
      `${env.BASE_URL}/dashboard/youtube?select_channel=true`,
    );
  } catch (err) {
    const code =
      err instanceof YouTubeConnectError ? err.code : "connection_failed";
    console.error(
      `[youtube/callback] ${code} for user ${userId}:`,
      err instanceof Error ? err.message : err,
    );

    return NextResponse.redirect(
      `${env.BASE_URL}/dashboard/youtube?error=${code}`,
    );
  }
}
