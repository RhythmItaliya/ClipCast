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
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { processYoutubeVideo } from "~/actions/generation";
import { YoutubeIcon } from "~/components/brand";
import {
  disconnectYouTubeChannel,
  getChannelVideos,
  getYouTubeAuthUrl,
  type YouTubeVideo,
} from "~/actions/youtube";
import { getFriendlyErrorMessage, isOffline, FRIENDLY_MESSAGES } from "~/lib/errors";

export function YouTubeChannelClient({
  isConnected,
  channelName,
  connected,
  oauthError,
}: {
  isConnected: boolean;
  channelName: string | null;
  connected: boolean;
  oauthError: string | null;
}) {
  const [videos, setVideos] = useState<YouTubeVideo[]>([]);
  const [loadingVideos, setLoadingVideos] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);

  useEffect(() => {
    if (connected) toast.success("YouTube channel connected!");
    if (oauthError) {
      let title = "Connection failed";
      let desc = "An unexpected error occurred while connecting your channel.";

      if (oauthError === "no_channel") {
        title = "No Channel Found";
        desc =
          "The Google account you selected does not have a YouTube channel associated with it. Please create a channel first or use a different account.";
      } else if (oauthError === "oauth_failed") {
        desc = "Failed to securely exchange authentication tokens.";
      } else if (oauthError === "access_denied") {
        desc = "You denied access to your YouTube channel.";
      }

      toast.error(title, { description: desc });
    }
  }, [connected, oauthError]);

  const fetchVideos = useCallback(async () => {
    setLoadingVideos(true);
    try {
      const result = await getChannelVideos(12);
      if (result.success && result.videos) {
        setVideos(result.videos);
      } else {
        toast.error("Failed to load videos", { description: result.error });
      }
    } catch (e) {
      toast.error("Failed to load videos", {
        description: getFriendlyErrorMessage(e),
      });
    } finally {
      setLoadingVideos(false);
    }
  }, []);

  useEffect(() => {
    if (isConnected) void fetchVideos();
  }, [isConnected, fetchVideos]);

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
      setVideos([]);
      toast.success("YouTube channel disconnected.");
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

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Channel connection */}
      <section className="border-border from-brand/15 overflow-hidden rounded-3xl border bg-gradient-to-br via-transparent to-transparent p-7">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 sm:flex sm:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <div className="bg-brand text-brand-foreground grid size-12 shrink-0 place-items-center rounded-2xl">
              <YoutubeIcon className="size-6" />
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-lg font-semibold">
                {isConnected && channelName
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
              isConnected
                ? "bg-brand-soft text-brand ring-brand/20"
                : "bg-surface-2 text-muted-foreground ring-border"
            }`}
          >
            {isConnected ? "Connected" : "Not connected"}
          </span>
        </div>
        <button
          onClick={isConnected ? handleDisconnect : handleConnect}
          disabled={connecting || disconnecting}
          className={`mt-6 flex w-full items-center justify-center gap-2 rounded-full px-4 py-3 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-60 sm:w-auto ${
            isConnected
              ? "border-border bg-surface text-foreground border"
              : "bg-brand text-brand-foreground"
          }`}
        >
          {connecting || disconnecting ? (
            <Loader2 className="size-4 animate-spin" />
          ) : isConnected ? (
            <LogOut className="size-4" />
          ) : (
            <YoutubeIcon className="size-4" />
          )}
          {isConnected ? "Disconnect Channel" : "Connect YouTube Channel"}
        </button>
      </section>

      {/* Latest videos (only when connected) */}
      {isConnected && (
        <section className="border-border bg-surface/60 rounded-3xl border p-7">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold">Latest videos</h2>
              <p className="text-muted-foreground text-xs">
                Queue any upload for clipping in highlights mode.
              </p>
            </div>
            <button
              onClick={fetchVideos}
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
          <div className="min-w-0">
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
        </div>
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
