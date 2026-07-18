"use client";

import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Clock,
  Download,
  ExternalLink,
  Loader2,
  Music,
  Play,
  Scissors,
  Trash2,
  Upload,
  Video,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { deleteClip, getClipUrl } from "~/actions/clips";
import { uploadClipToYouTube } from "~/actions/youtube";
import { YoutubeIcon } from "~/components/brand";
import { useConfirm } from "~/components/ui/confirm-dialog";
import { useLazyThumbnails } from "~/hooks/use-lazy-thumbnails";
import {
  FRIENDLY_MESSAGES,
  getFriendlyErrorMessage,
  isOffline,
} from "~/lib/errors";
import type { ClipGroup, ClipItem } from "~/types";

/** Formats seconds as "m:ss" for the duration badge. */
function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

const THUMB_GRADIENTS = [
  "from-indigo-500 via-purple-500 to-pink-500",
  "from-sky-500 via-blue-500 to-indigo-500",
  "from-emerald-500 via-teal-500 to-cyan-500",
  "from-fuchsia-500 via-pink-500 to-rose-500",
  "from-orange-500 via-rose-500 to-red-500",
  "from-lime-500 via-emerald-500 to-teal-500",
];

export function ClipsGrid({
  groups,
  youtubeConnected = false,
  page = 1,
  pageSize = 8,
  total = 0,
  basePath = "/dashboard/clips",
  emptyState,
}: {
  groups: ClipGroup[];
  youtubeConnected?: boolean;
  page?: number;
  pageSize?: number;
  total?: number;
  /** Where the pagination Prev/Next navigate (clips vs audio outputs). */
  basePath?: string;
  emptyState?: React.ReactNode;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <section className="space-y-6">
      {groups.length === 0 ? (
        (emptyState ?? <EmptyState />)
      ) : (
        <>
          <div className="space-y-4">
            {groups.map((g) => (
              <VideoGroupSection
                key={g.id}
                group={g}
                youtubeConnected={youtubeConnected}
              />
            ))}
          </div>
          <Pagination
            page={page}
            totalPages={totalPages}
            total={total}
            basePath={basePath}
          />
        </>
      )}
    </section>
  );
}

function Pagination({
  page,
  totalPages,
  total,
  basePath,
}: {
  page: number;
  totalPages: number;
  total: number;
  basePath: string;
}) {
  const router = useRouter();
  if (totalPages <= 1) return null;
  const go = (p: number) => router.push(`${basePath}?page=${p}`);
  return (
    <div className="flex items-center justify-between gap-3">
      <p className="text-muted-foreground text-xs">
        {total.toLocaleString()} source{total !== 1 ? "s" : ""} · page {page} of{" "}
        {totalPages}
      </p>
      <div className="flex items-center gap-2">
        <button
          onClick={() => go(page - 1)}
          disabled={page <= 1}
          className="border-border bg-surface hover:bg-surface-2 flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-medium disabled:opacity-50"
        >
          <ChevronLeft className="size-3.5" /> Prev
        </button>
        <button
          onClick={() => go(page + 1)}
          disabled={page >= totalPages}
          className="border-border bg-surface hover:bg-surface-2 flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-medium disabled:opacity-50"
        >
          Next <ChevronRight className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

function VideoGroupSection({
  group,
  youtubeConnected,
}: {
  group: ClipGroup;
  youtubeConnected: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { urls: thumbnails, load } = useLazyThumbnails();
  const isAudioGroup =
    group.clips.length > 0 &&
    group.clips.every((c) => c.mediaType === "audio");

  // Presign this group's thumbnails only the first time it's expanded.
  const toggle = useCallback(() => {
    setOpen((wasOpen) => {
      if (!wasOpen) void load(group.clips.map((c) => c.id));
      return !wasOpen;
    });
  }, [load, group.clips]);

  return (
    <div className="border-border bg-surface/40 rounded-3xl border">
      <button
        type="button"
        onClick={toggle}
        className="hover:bg-surface-2 flex w-full cursor-pointer items-center justify-between gap-4 rounded-3xl px-5 py-4 text-left transition-colors"
      >
        <div className="flex min-w-0 items-center gap-3">
          <span className="bg-brand-soft text-brand grid size-10 shrink-0 place-items-center rounded-2xl">
            {isAudioGroup ? (
              <Music className="size-5" />
            ) : (
              <Video className="size-5" />
            )}
          </span>
          <div className="min-w-0">
            <h3 className="truncate text-sm leading-tight font-semibold">
              {group.title}
            </h3>
            <p className="text-muted-foreground mt-0.5 text-xs">
              {group.clips.length} clip{group.clips.length !== 1 ? "s" : ""}
            </p>
          </div>
        </div>
        <ChevronDown
          className={`text-muted-foreground size-4 shrink-0 transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {open && (
        <div className="border-border border-t px-5 pt-3">
          <Link
            href={`/dashboard/production/${group.id}`}
            className="text-muted-foreground hover:text-brand inline-flex items-center gap-1.5 text-xs font-medium"
          >
            <Clapperboard className="size-3.5" /> Production Room — see how the AI
            crew decided this
          </Link>
        </div>
      )}
      {open && (
        <div className="grid grid-cols-2 gap-4 p-5 pt-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {group.clips.map((clip, i) => (
            <ClipCard
              key={clip.id}
              clip={clip}
              thumbnailUrl={thumbnails[clip.id] ?? clip.thumbnailUrl ?? null}
              source={group.title}
              index={i}
              youtubeConnected={youtubeConnected}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ClipCard({
  clip,
  thumbnailUrl,
  source,
  index,
  youtubeConnected,
}: {
  clip: ClipItem;
  thumbnailUrl: string | null;
  source: string;
  index: number;
  youtubeConnected: boolean;
}) {
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState<"play" | "download" | "delete" | null>(
    null,
  );
  const [postModalOpen, setPostModalOpen] = useState(false);
  const [posting, setPosting] = useState(false);
  const [postTitle, setPostTitle] = useState(clip.title);
  const [postDescription, setPostDescription] = useState("");
  const [postPrivacy, setPostPrivacy] = useState<
    "public" | "unlisted" | "private"
  >("public");
  const [postError, setPostError] = useState<string | null>(null);
  const [postedVideoId, setPostedVideoId] = useState(
    clip.youtubeVideoId ?? null,
  );
  const confirm = useConfirm();
  const router = useRouter();
  const gradient = THUMB_GRADIENTS[index % THUMB_GRADIENTS.length]!;
  // Audio Studio outputs (mashups / generated tracks) are audio-only: play them
  // in an <audio> element and hide the video-only "Post to YouTube" action.
  const isAudio = clip.mediaType === "audio";

  const handlePlay = async () => {
    if (loading) return;
    if (isOffline()) {
      toast.error(FRIENDLY_MESSAGES.offline);
      return;
    }
    setLoading("play");
    try {
      const res = await getClipUrl(clip.id);
      if (res.success) {
        setVideoUrl(res.url);
      } else {
        toast.error("Couldn't load the clip", { description: res.error });
      }
    } catch (e) {
      toast.error("Couldn't load the clip", {
        description: getFriendlyErrorMessage(e),
      });
    } finally {
      setLoading(null);
    }
  };

  const handleDownload = async () => {
    if (loading) return;
    if (isOffline()) {
      toast.error(FRIENDLY_MESSAGES.offline);
      return;
    }
    setLoading("download");
    try {
      const res = await getClipUrl(clip.id, true);
      if (res.success) {
        const a = document.createElement("a");
        a.href = res.url;
        a.download = "";
        document.body.appendChild(a);
        a.click();
        a.remove();
      } else {
        toast.error("Download failed", { description: res.error });
      }
    } catch (e) {
      toast.error("Download failed", {
        description: getFriendlyErrorMessage(e),
      });
    } finally {
      setLoading(null);
    }
  };

  const handleDelete = async () => {
    if (loading) return;
    const ok = await confirm({
      title: "Delete this clip?",
      description: "This clip will be permanently deleted.",
      confirmLabel: "Delete clip",
      destructive: true,
    });
    if (!ok) return;
    setLoading("delete");
    try {
      const res = await deleteClip(clip.id);
      if (res.success) {
        toast.success("Clip deleted.");
        router.refresh();
      } else {
        toast.error("Couldn't delete the clip", { description: res.error });
      }
    } catch (e) {
      toast.error("Couldn't delete the clip", {
        description: getFriendlyErrorMessage(e),
      });
    } finally {
      setLoading(null);
    }
  };

  const handlePost = async (e: React.FormEvent) => {
    e.preventDefault();
    if (posting) return;
    if (isOffline()) {
      setPostError(FRIENDLY_MESSAGES.offline);
      return;
    }
    setPosting(true);
    setPostError(null);
    try {
      const res = await uploadClipToYouTube(clip.id, {
        title: postTitle,
        description: postDescription || undefined,
        privacyStatus: postPrivacy,
      });
      if (res.success) {
        setPostedVideoId(res.videoId);
        setPostModalOpen(false);
        toast.success("Posted to YouTube!", {
          description: "Your clip is now live on your channel.",
        });
      } else {
        setPostError(res.error);
      }
    } catch (err) {
      setPostError(getFriendlyErrorMessage(err));
    } finally {
      setPosting(false);
    }
  };

  return (
    <article className="group border-border bg-background hover:border-brand/40 hover:shadow-brand/5 overflow-hidden rounded-2xl border transition-all hover:-translate-y-0.5 hover:shadow-lg">
      <div
        className={`relative aspect-[9/12] ${
          !isAudio && thumbnailUrl
            ? "bg-black"
            : `bg-gradient-to-br ${gradient}`
        }`}
      >
        {videoUrl && isAudio ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-4">
            <Music className="size-12 text-white/90" />
            <audio src={videoUrl} controls autoPlay className="w-full">
              <track kind="captions" />
            </audio>
          </div>
        ) : videoUrl ? (
          <video
            src={videoUrl}
            controls
            autoPlay
            playsInline
            className="absolute inset-0 h-full w-full bg-black object-contain"
          />
        ) : (
          <>
            {!isAudio && thumbnailUrl && (
              <img
                src={thumbnailUrl}
                alt=""
                className="absolute inset-0 h-full w-full object-cover"
              />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/10" />
            {isAudio && (
              <Music className="absolute inset-0 m-auto size-12 text-white/70" />
            )}
            <button
              onClick={handlePlay}
              className="absolute inset-0 grid place-items-center opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
              title={isAudio ? "Play track" : "Play clip"}
            >
              <span className="grid size-14 place-items-center rounded-full bg-white/90 text-black shadow-lg backdrop-blur-sm transition-transform group-hover:scale-110">
                {loading === "play" ? (
                  <Loader2 className="size-6 animate-spin" />
                ) : (
                  <Play className="size-6 translate-x-0.5 fill-current" />
                )}
              </span>
            </button>
            <span className="absolute bottom-3 left-3 flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-semibold text-white capitalize backdrop-blur-sm">
              <Clock className="size-3" />
              {clip.isPreview ? "Preview · " : ""}
              {clip.clipMode}
            </span>
            {typeof clip.duration === "number" && clip.duration > 0 && (
              <span className="absolute right-3 bottom-3 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur-sm">
                {formatDuration(clip.duration)}
              </span>
            )}
          </>
        )}
      </div>

      <div className="space-y-3 p-4">
        <div>
          <h3 className="line-clamp-2 text-sm leading-snug font-semibold">
            {clip.title}
          </h3>
          <p className="text-muted-foreground mt-1 truncate text-[11px]">
            from <span className="text-foreground/70">{source}</span>
          </p>
        </div>
        <div className="text-muted-foreground text-[11px]">
          {clip.createdAt}
        </div>
        <div className="border-border flex items-center gap-1.5 border-t pt-3">
          <button
            onClick={handleDownload}
            disabled={loading !== null}
            className="bg-brand text-brand-foreground flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {loading === "download" ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Download className="size-3.5" />
            )}{" "}
            Download
          </button>
          <button
            onClick={handleDelete}
            disabled={loading !== null}
            title="Delete"
            className="border-border text-muted-foreground hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive grid size-9 place-items-center rounded-lg border disabled:opacity-50"
          >
            {loading === "delete" ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Trash2 className="size-3.5" />
            )}
          </button>
          {youtubeConnected &&
            !isAudio &&
            (postedVideoId ? (
              <a
                href={`https://www.youtube.com/watch?v=${postedVideoId}`}
                target="_blank"
                rel="noopener noreferrer"
                title="View on YouTube"
                className="border-border text-brand hover:bg-brand-soft grid size-9 place-items-center rounded-lg border"
              >
                <ExternalLink className="size-3.5" />
              </a>
            ) : (
              <button
                onClick={() => setPostModalOpen(true)}
                disabled={loading !== null}
                title="Post to YouTube"
                className="border-border text-muted-foreground hover:border-brand/40 hover:bg-brand-soft hover:text-brand grid size-9 place-items-center rounded-lg border disabled:opacity-50"
              >
                <YoutubeIcon className="size-3.5" />
              </button>
            ))}
        </div>
      </div>

      {postModalOpen && (
        <div
          className="fixed inset-0 z-[200] grid place-items-center bg-black/50 p-4 backdrop-blur-sm"
          onClick={() => !posting && setPostModalOpen(false)}
        >
          <form
            onSubmit={handlePost}
            onClick={(e) => e.stopPropagation()}
            className="border-border bg-surface w-full max-w-sm rounded-3xl border p-6 shadow-xl"
          >
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-base font-semibold">
                <YoutubeIcon className="text-brand size-4" /> Post to YouTube
              </h2>
              <button
                type="button"
                onClick={() => setPostModalOpen(false)}
                disabled={posting}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="mt-4 space-y-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium">Title</span>
                <input
                  value={postTitle}
                  onChange={(e) => setPostTitle(e.target.value)}
                  maxLength={100}
                  required
                  className="border-border bg-background focus:border-brand w-full rounded-xl border px-3 py-2 text-sm outline-none"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium">
                  Description (optional)
                </span>
                <textarea
                  value={postDescription}
                  onChange={(e) => setPostDescription(e.target.value)}
                  rows={3}
                  className="border-border bg-background focus:border-brand w-full resize-none rounded-xl border px-3 py-2 text-sm outline-none"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium">
                  Visibility
                </span>
                <select
                  value={postPrivacy}
                  onChange={(e) =>
                    setPostPrivacy(
                      e.target.value as "public" | "unlisted" | "private",
                    )
                  }
                  className="border-border bg-background focus:border-brand w-full rounded-xl border px-3 py-2 text-sm outline-none"
                >
                  <option value="public">Public</option>
                  <option value="unlisted">Unlisted</option>
                  <option value="private">Private</option>
                </select>
              </label>

              {postError && (
                <p className="bg-destructive/10 text-destructive rounded-xl p-3 text-sm">
                  {postError}
                </p>
              )}

              <button
                type="submit"
                disabled={posting}
                className="bg-brand text-brand-foreground flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {posting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Upload className="size-4" />
                )}
                {posting ? "Posting…" : "Post to YouTube"}
              </button>
            </div>
          </form>
        </div>
      )}
    </article>
  );
}

function EmptyState() {
  return (
    <div className="border-border bg-surface/40 grid place-items-center rounded-3xl border border-dashed px-6 py-16 text-center">
      <div className="bg-brand-soft text-brand grid size-12 place-items-center rounded-2xl">
        <Scissors className="size-5" />
      </div>
      <h3 className="mt-4 text-base font-semibold">No clips yet</h3>
      <p className="text-muted-foreground mt-1 max-w-sm text-sm">
        Upload a podcast or paste a YouTube link to generate your first clips.
      </p>
    </div>
  );
}
