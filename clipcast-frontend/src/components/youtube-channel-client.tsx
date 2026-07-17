"use client";

import {
  CheckCircle2,
  Clock,
  ExternalLink,
  Loader2,
  LogOut,
  Radio,
  RefreshCw,
  Scissors,
  Zap,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { processYoutubeVideo } from "~/actions/generation";
import { YoutubeIcon } from "~/components/brand";
import {
  disconnectYouTubeChannel,
  getChannelVideos,
  getYouTubeAuthUrl,
  selectYouTubeChannel,
  setYouTubeAutoClip,
} from "~/actions/youtube";
import type { PendingYouTubeChannel, YouTubeVideo } from "~/types";
import {
  getFriendlyErrorMessage,
  isOffline,
  FRIENDLY_MESSAGES,
} from "~/lib/errors";

const channelVideoCache = new Map<string, YouTubeVideo[]>();

export function YouTubeChannelClient({
  isConnected,
  channelId,
  channelName,
  connected,
  oauthError,
  pendingChannels,
  autoClipEnabled,
}: {
  isConnected: boolean;
  channelId: string | null;
  channelName: string | null;
  connected: boolean;
  oauthError: string | null;
  pendingChannels: PendingYouTubeChannel[];
  autoClipEnabled: boolean;
}) {
  const router = useRouter();
  const [connectionActive, setConnectionActive] = useState(isConnected);
  const [videos, setVideos] = useState<YouTubeVideo[]>(() =>
    channelId ? (channelVideoCache.get(channelId) ?? []) : [],
  );
  const [loadingVideos, setLoadingVideos] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [selectingChannelId, setSelectingChannelId] = useState<string | null>(
    null,
  );
  const [autoClip, setAutoClip] = useState(autoClipEnabled);
  const [savingAutoClip, setSavingAutoClip] = useState(false);
  const hasPendingChannels = pendingChannels.length > 0;
  const initialFetchStarted = useRef(false);
  const oauthNoticeShown = useRef(false);
  const videoRequestSequence = useRef(0);

  useEffect(() => setConnectionActive(isConnected), [isConnected]);

  useEffect(() => {
    if (oauthNoticeShown.current) return;
    if (connected || oauthError) oauthNoticeShown.current = true;
    if (connected) toast.success("YouTube channel connected!");
    if (oauthError) {
      let title = "Connection failed";
      let desc = "An unexpected error occurred while connecting your channel.";

      if (oauthError === "no_channel") {
        title = "No Channel Found";
        desc =
          "The Google account you selected does not have a YouTube channel associated with it. Please create a channel first or use a different account.";
      } else if (oauthError === "api_error") {
        title = "Couldn't verify your channel";
        desc =
          "Google returned an unexpected channel lookup error. Try reconnecting once; if it repeats, check the local server log for the exact Google response.";
      } else if (oauthError === "api_disabled") {
        title = "YouTube API is not enabled for this OAuth client";
        desc =
          "Enable YouTube Data API v3 in the exact Google Cloud project that owns this OAuth Client ID, wait a few minutes, then reconnect.";
      } else if (oauthError === "insufficient_scope") {
        title = "YouTube permission was not granted";
        desc =
          "Remove ClipCast/Test from your Google Account connections, reconnect, and approve all requested YouTube permissions.";
      } else if (oauthError === "quota_exceeded") {
        title = "YouTube API quota exceeded";
        desc = "Wait for Google's daily quota reset, then reconnect.";
      } else if (oauthError === "youtube_account_required") {
        title = "No YouTube channel on this Google account";
        desc =
          "Create a YouTube channel for this Google account, or reconnect using the Google account that owns your channel.";
      } else if (oauthError === "oauth_failed") {
        desc =
          "Failed to securely exchange authentication tokens. Please try connecting again.";
      } else if (oauthError === "access_denied") {
        desc = "You denied access to your YouTube channel.";
      }

      toast.error(title, { description: desc });
    }
    // Strip connected/error/select_channel from the URL once we've shown the
    // toast for them — otherwise refreshing the page re-reads the same
    // query params and shows the exact same toast again, every time.
    if (connected || oauthError) {
      router.replace("/dashboard/youtube");
    }
  }, [connected, oauthError, router]);

  async function handleSelectChannel(channel: PendingYouTubeChannel) {
    setSelectingChannelId(channel.id);
    try {
      const result = await selectYouTubeChannel(channel.id);
      if (result.success) {
        toast.success("YouTube channel connected!", {
          description: channel.title,
        });
        router.replace("/dashboard/youtube");
        router.refresh();
      } else {
        toast.error("Could not connect that channel", {
          description: result.error,
        });
      }
    } catch (e) {
      toast.error("Could not connect that channel", {
        description: getFriendlyErrorMessage(e),
      });
    } finally {
      setSelectingChannelId(null);
    }
  }

  const fetchVideos = useCallback(
    async (force = false) => {
      if (!channelId) return;
      const cached = channelVideoCache.get(channelId);
      if (!force && cached) {
        setVideos(cached);
        return;
      }
      const requestSequence = ++videoRequestSequence.current;
      setLoadingVideos(true);
      setVideoError(null);
      try {
        const result = await getChannelVideos(12);
        if (requestSequence !== videoRequestSequence.current) return;
        if (result.success && result.videos) {
          setVideos(result.videos);
          channelVideoCache.set(channelId, result.videos);
        } else {
          setVideoError(result.error ?? "Could not load channel videos.");
        }
      } catch (e) {
        if (requestSequence !== videoRequestSequence.current) return;
        setVideoError(getFriendlyErrorMessage(e));
      } finally {
        if (requestSequence === videoRequestSequence.current) {
          setLoadingVideos(false);
        }
      }
    },
    [channelId],
  );

  useEffect(() => {
    if (connectionActive && !initialFetchStarted.current) {
      initialFetchStarted.current = true;
      void fetchVideos();
    }
  }, [connectionActive, fetchVideos]);

  async function handleConnect() {
    if (isOffline()) {
      toast.error(FRIENDLY_MESSAGES.offline);
      return;
    }
    setConnecting(true);
    try {
      const url = await getYouTubeAuthUrl();
      window.location.href = url;
    } catch {
      toast.error("Could not start YouTube OAuth flow.");
      setConnecting(false);
    }
  }

  async function handleDisconnect() {
    setDisconnecting(true);
    try {
      await disconnectYouTubeChannel();
      videoRequestSequence.current += 1;
      if (channelId) channelVideoCache.delete(channelId);
      setVideos([]);
      setConnectionActive(false);
      toast.success("YouTube channel disconnected.");
      router.refresh();
    } catch (e) {
      toast.error("Could not disconnect", {
        description: getFriendlyErrorMessage(e),
      });
    } finally {
      setDisconnecting(false);
    }
  }

  async function handleProcessVideo(video: YouTubeVideo) {
    if (processingId) return;
    if (isOffline()) {
      toast.error(FRIENDLY_MESSAGES.offline);
      return;
    }
    setProcessingId(video.id);
    try {
      const result = await processYoutubeVideo(video.url, "highlights");
      if (result.success) {
        toast.success("Video queued!", {
          description: `"${video.title}" is being processed in highlights mode.`,
        });
      } else {
        toast.error("Failed to queue video", { description: result.error });
      }
    } catch (e) {
      toast.error("Failed to queue video", {
        description: getFriendlyErrorMessage(e),
      });
    } finally {
      setProcessingId(null);
    }
  }

  async function handleAutoClipToggle() {
    if (!connectionActive || savingAutoClip) return;
    const next = !autoClip;
    setAutoClip(next);
    setSavingAutoClip(true);
    try {
      const result = await setYouTubeAutoClip(next);
      if (!result.success) {
        setAutoClip(!next);
        toast.error("Could not update automation", {
          description: result.error,
        });
        return;
      }
      toast.success(next ? "Auto-clip enabled" : "Auto-clip paused");
    } catch (e) {
      setAutoClip(!next);
      toast.error("Could not update automation", {
        description: getFriendlyErrorMessage(e),
      });
    } finally {
      setSavingAutoClip(false);
    }
  }

  return (
    <div className="w-full space-y-6">
      {/* Channel connection */}
      <section className="border-border from-brand/15 overflow-hidden rounded-3xl border bg-gradient-to-br via-transparent to-transparent p-7">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 sm:flex sm:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <div className="bg-brand text-brand-foreground grid size-12 shrink-0 place-items-center rounded-2xl">
              <YoutubeIcon className="size-6" />
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-lg font-semibold">
                {connectionActive && channelName
                  ? channelName
                  : "Channel connection"}
              </h2>
              <p className="text-muted-foreground mt-1 text-sm">
                Connect your YouTube channel and ClipCast will find, download,
                and clip new uploads automatically.
              </p>
            </div>
          </div>
          <span
            className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold tracking-widest uppercase ring-1 ${
              connectionActive
                ? "bg-brand-soft text-brand ring-brand/20"
                : "bg-surface-2 text-muted-foreground ring-border"
            }`}
          >
            {connectionActive ? "Connected" : "Not connected"}
          </span>
        </div>
        {!hasPendingChannels && (
          <button
            onClick={connectionActive ? handleDisconnect : handleConnect}
            disabled={connecting || disconnecting}
            className={`mt-6 flex w-full items-center justify-center gap-2 rounded-full px-4 py-3 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-60 sm:w-auto ${
              connectionActive
                ? "border-border bg-surface text-foreground border"
                : "bg-brand text-brand-foreground"
            }`}
          >
            {connecting || disconnecting ? (
              <Loader2 className="size-4 animate-spin" />
            ) : connectionActive ? (
              <LogOut className="size-4" />
            ) : (
              <YoutubeIcon className="size-4" />
            )}
            {connectionActive
              ? "Disconnect Channel"
              : "Connect YouTube Channel"}
          </button>
        )}
      </section>

      {/* Channel picker: shown when the connected Google account manages
          more than one channel, so the user picks which one instead of us
          guessing the first one Google's API happens to return. */}
      {hasPendingChannels && (
        <section className="border-border bg-surface/60 rounded-3xl border p-7">
          <h2 className="text-base font-semibold">Choose a channel</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            This Google account manages more than one YouTube channel. Pick the
            one you want ClipCast to auto-clip.
          </p>
          <div className="mt-4 space-y-2">
            {pendingChannels.map((channel) => (
              <button
                key={channel.id}
                onClick={() => handleSelectChannel(channel)}
                disabled={selectingChannelId !== null}
                className="border-border bg-background hover:bg-surface-2 flex w-full items-center gap-3 rounded-2xl border p-4 text-left transition-colors disabled:opacity-60"
              >
                <div className="bg-brand-soft text-brand grid size-10 shrink-0 place-items-center rounded-xl">
                  <YoutubeIcon className="size-5" />
                </div>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {channel.title}
                </span>
                {selectingChannelId === channel.id ? (
                  <Loader2 className="size-4 shrink-0 animate-spin" />
                ) : (
                  <CheckCircle2 className="text-muted-foreground size-4 shrink-0" />
                )}
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Latest videos (only when connected) */}
      {connectionActive && (
        <section className="border-border bg-surface/60 rounded-3xl border p-7">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold">Latest videos</h2>
              <p className="text-muted-foreground text-xs">
                Queue any upload for clipping in highlights mode.
              </p>
            </div>
            <button
              onClick={() => void fetchVideos(true)}
              disabled={loadingVideos}
              className="border-border bg-surface hover:bg-surface-2 flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium disabled:opacity-60"
            >
              {loadingVideos ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}{" "}
              Refresh
            </button>
          </div>

          {loadingVideos && videos.length === 0 ? (
            <div className="text-muted-foreground grid place-items-center py-10 text-sm">
              <Loader2 className="mb-2 size-5 animate-spin" />
              Loading your uploads…
            </div>
          ) : videoError ? (
            <div className="border-destructive/20 bg-destructive/5 rounded-2xl border px-5 py-6 text-center">
              <p className="text-destructive text-sm font-medium">
                Could not load your uploads
              </p>
              <p className="text-muted-foreground mt-1 text-xs">{videoError}</p>
              <button
                type="button"
                onClick={() => void fetchVideos(true)}
                className="border-border bg-surface hover:bg-surface-2 mt-4 rounded-full border px-4 py-2 text-xs font-semibold"
              >
                Try again
              </button>
            </div>
          ) : videos.length === 0 ? (
            <p className="text-muted-foreground py-6 text-center text-sm">
              No videos found on this channel yet.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {videos.map((video) => (
                <div
                  key={video.id}
                  className="border-border bg-background overflow-hidden rounded-2xl border"
                >
                  {video.thumbnailUrl && (
                    <img
                      src={video.thumbnailUrl}
                      alt={video.title}
                      className="aspect-video w-full object-cover"
                    />
                  )}
                  <div className="space-y-2 p-3">
                    <h3 className="line-clamp-2 text-sm leading-snug font-medium">
                      {video.title}
                    </h3>
                    <p className="text-muted-foreground text-xs">
                      {video.duration} · {video.viewCount} views
                    </p>
                    <div className="flex items-center gap-1.5 pt-1">
                      <button
                        onClick={() => handleProcessVideo(video)}
                        disabled={processingId !== null}
                        className="bg-brand text-brand-foreground flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-opacity hover:opacity-90 disabled:opacity-50"
                      >
                        {processingId === video.id ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Scissors className="size-3.5" />
                        )}{" "}
                        Clip it
                      </button>
                      <a
                        href={video.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Open on YouTube"
                        className="border-border text-muted-foreground hover:text-foreground grid size-9 place-items-center rounded-lg border"
                      >
                        <ExternalLink className="size-3.5" />
                      </a>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Auto-schedule */}
      <section className="border-border bg-surface/60 rounded-3xl border p-7">
        <div className="flex items-start gap-4">
          <div className="bg-brand-soft text-brand ring-brand/20 grid size-11 shrink-0 place-items-center rounded-2xl ring-1">
            <Clock className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold">
              Auto-schedule · Daily CRON
            </h2>
            <p className="text-muted-foreground mt-1.5 text-sm leading-relaxed">
              Once connected, we process your latest video every day at{" "}
              <span className="text-foreground font-semibold">09:00 UTC</span>{" "}
              and queue clips on your dashboard for review, download, or
              publish.
            </p>
            <div className="bg-brand-soft text-brand ring-brand/20 mt-4 inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs ring-1">
              <Zap className="size-3" /> Requires active credits to maintain
              schedule
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={autoClip}
            aria-label="Automatically clip new YouTube uploads"
            onClick={handleAutoClipToggle}
            disabled={!connectionActive || savingAutoClip}
            className={`relative mt-1 h-6 w-11 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              autoClip ? "bg-brand" : "bg-surface-2 ring-border ring-1"
            }`}
          >
            <span
              className={`absolute top-1 size-4 rounded-full shadow-sm transition-all ${
                autoClip
                  ? "bg-brand-foreground left-6"
                  : "bg-muted-foreground left-1"
              }`}
            />
          </button>
        </div>
        <p className="text-muted-foreground border-border mt-4 border-t pt-4 text-xs">
          {connectionActive
            ? autoClip
              ? "Automation is active. Each new upload is queued once in Highlights mode."
              : "Automation is paused. You can still use Clip it on any video above."
            : "Connect a channel before enabling automation."}
        </p>
      </section>

      {/* Features */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[
          {
            icon: Radio,
            t: "Live sync",
            d: "Detects new uploads within 15 minutes of publish.",
          },
          {
            icon: CheckCircle2,
            t: "Smart filters",
            d: "Skip videos under 3 minutes or non-podcast content.",
          },
          {
            icon: Zap,
            t: "Zero clicks",
            d: "Clips are ready to download when you check your dashboard.",
          },
        ].map(({ icon: Icon, t, d }) => (
          <div
            key={t}
            className="border-border bg-surface/60 rounded-2xl border p-5"
          >
            <div className="bg-brand-soft text-brand grid size-9 place-items-center rounded-xl">
              <Icon className="size-4" />
            </div>
            <div className="mt-3 text-sm font-semibold">{t}</div>
            <div className="text-muted-foreground mt-1 text-xs">{d}</div>
          </div>
        ))}
      </section>
    </div>
  );
}
