"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ExternalLink,
  Loader2,
  RefreshCw,
  Tv,
  Zap,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";
import { toast } from "sonner";
import {
  getYouTubeAuthUrl,
  disconnectYouTubeChannel,
  getChannelVideos,
  type YouTubeVideo,
} from "~/actions/youtube";
import { processYoutubeVideo } from "~/actions/generation";

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

  useEffect(() => {
    if (isConnected) void fetchVideos();
  }, [isConnected]);

  async function fetchVideos() {
    setLoadingVideos(true);
    const result = await getChannelVideos(12);
    if (result.success && result.videos) {
      setVideos(result.videos);
    } else {
      toast.error("Failed to load videos", { description: result.error });
    }
    setLoadingVideos(false);
  }

  async function handleConnect() {
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
    await disconnectYouTubeChannel();
    setVideos([]);
    setDisconnecting(false);
    toast.success("YouTube channel disconnected.");
  }

  async function handleProcessVideo(video: YouTubeVideo) {
    if (processingId) return;
    setProcessingId(video.id);
    const result = await processYoutubeVideo(video.url, "highlights");
    if (result.success) {
      toast.success("Video queued!", {
        description: `"${video.title}" is being processed in highlights mode.`,
      });
    } else {
      toast.error("Failed to queue video", { description: result.error });
    }
    setProcessingId(null);
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/dashboard">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            YouTube Channel
          </h1>
          <p className="text-muted-foreground text-sm">
            Connect your channel to auto-pull and clip your videos
          </p>
        </div>
      </div>

      {/* Connection card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Tv className="text-muted-foreground h-5 w-5" />
              <CardTitle>Channel Connection</CardTitle>
            </div>
            <Badge variant={isConnected ? "default" : "secondary"}>
              {isConnected ? "Connected" : "Not connected"}
            </Badge>
          </div>
          <CardDescription>
            {isConnected
              ? `Connected as: ${channelName ?? "Unknown channel"}`
              : "Connect your YouTube channel to automatically find and clip your videos."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex gap-2">
          {isConnected ? (
            <Button
              variant="destructive"
              onClick={handleDisconnect}
              disabled={disconnecting}
            >
              {disconnecting && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Disconnect Channel
            </Button>
          ) : (
            <Button onClick={handleConnect} disabled={connecting}>
              {connecting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Tv className="mr-2 h-4 w-4" />
              )}
              Connect YouTube Channel
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Videos grid */}
      {isConnected && (
        <div>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Your Videos</h2>
            <Button
              variant="outline"
              size="sm"
              onClick={fetchVideos}
              disabled={loadingVideos}
            >
              {loadingVideos ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Refresh
            </Button>
          </div>

          {loadingVideos && videos.length === 0 ? (
            <div className="flex h-48 items-center justify-center">
              <Loader2 className="text-muted-foreground h-8 w-8 animate-spin" />
            </div>
          ) : videos.length === 0 ? (
            <p className="text-muted-foreground p-4 text-center text-sm">
              No videos found on your channel.
            </p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {videos.map((video) => (
                <Card key={video.id} className="overflow-hidden">
                  <div className="relative">
                    <img
                      src={video.thumbnailUrl}
                      alt={video.title}
                      className="w-full object-cover"
                    />
                    <span className="bg-background/80 absolute right-2 bottom-2 rounded px-1.5 py-0.5 text-xs font-medium">
                      {video.duration}
                    </span>
                  </div>
                  <CardContent className="space-y-3 p-3">
                    <p className="line-clamp-2 text-sm leading-tight font-medium">
                      {video.title}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {video.viewCount} views ·{" "}
                      {new Date(video.publishedAt).toLocaleDateString()}
                    </p>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        className="flex-1"
                        onClick={() => handleProcessVideo(video)}
                        disabled={processingId === video.id}
                      >
                        {processingId === video.id ? (
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Zap className="mr-1.5 h-3.5 w-3.5" />
                        )}
                        Clip It
                      </Button>
                      <Button size="sm" variant="ghost" asChild>
                        <a
                          href={video.url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* CRON info */}
      <Card className="border-dashed">
        <CardHeader>
          <CardTitle className="text-base">
            Auto-Schedule (Daily CRON)
          </CardTitle>
          <CardDescription>
            When your channel is connected and you have credits, the system
            automatically processes your latest video every day at 09:00 UTC and
            queues a clip for your dashboard. Clips can then be manually
            downloaded or published.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
