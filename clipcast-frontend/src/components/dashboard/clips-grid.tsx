"use client";

import {
  ChevronDown,
  Clock,
  Download,
  Loader2,
  Play,
  Scissors,
  Trash2,
  Video,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { deleteClip, getClipUrl } from "~/actions/clips";
import {
  FRIENDLY_MESSAGES,
  getFriendlyErrorMessage,
  isOffline,
} from "~/lib/errors";

export type ClipItem = {
  id: string;
  title: string;
  clipMode: string;
  isPreview: boolean;
  createdAt: string;
};

export type ClipGroup = {
  id: string;
  title: string;
  clips: ClipItem[];
};

const THUMB_GRADIENTS = [
  "from-indigo-500 via-purple-500 to-pink-500",
  "from-sky-500 via-blue-500 to-indigo-500",
  "from-emerald-500 via-teal-500 to-cyan-500",
  "from-fuchsia-500 via-pink-500 to-rose-500",
  "from-orange-500 via-rose-500 to-red-500",
  "from-lime-500 via-emerald-500 to-teal-500",
];

export function ClipsGrid({ groups }: { groups: ClipGroup[] }) {
  return (
    <section className="space-y-6">
      {groups.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="space-y-4">
          {groups.map((g, i) => (
            <VideoGroupSection key={g.id} group={g} groupIndex={i} />
          ))}
        </div>
      )}
    </section>
  );
}

function VideoGroupSection({
  group,
  groupIndex,
}: {
  group: ClipGroup;
  groupIndex: number;
}) {
  const [open, setOpen] = useState(groupIndex === 0);
  return (
    <div className="border-border bg-surface/40 rounded-3xl border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="hover:bg-surface/60 flex w-full items-center justify-between gap-4 rounded-3xl px-5 py-4 text-left transition-colors"
      >
        <div className="flex min-w-0 items-center gap-3">
          <span className="bg-brand-soft text-brand grid size-10 shrink-0 place-items-center rounded-2xl">
            <Video className="size-5" />
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
        <div className="border-border grid grid-cols-1 gap-4 border-t p-5 sm:grid-cols-2 xl:grid-cols-3">
          {group.clips.map((clip, i) => (
            <ClipCard key={clip.id} clip={clip} source={group.title} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}

function ClipCard({
  clip,
  source,
  index,
}: {
  clip: ClipItem;
  source: string;
  index: number;
}) {
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState<"play" | "download" | "delete" | null>(
    null,
  );
  const router = useRouter();
  const gradient = THUMB_GRADIENTS[index % THUMB_GRADIENTS.length]!;

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
    if (!window.confirm("Delete this clip permanently?")) return;
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

  return (
    <article className="group border-border bg-background hover:border-brand/40 hover:shadow-brand/5 overflow-hidden rounded-2xl border transition-all hover:-translate-y-0.5 hover:shadow-lg">
      <div className={`relative aspect-[9/12] bg-gradient-to-br ${gradient}`}>
        {videoUrl ? (
          <video
            src={videoUrl}
            controls
            autoPlay
            playsInline
            className="absolute inset-0 h-full w-full bg-black object-contain"
          />
        ) : (
          <>
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/10" />
            <button
              onClick={handlePlay}
              className="absolute inset-0 grid place-items-center opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
              title="Play clip"
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
        </div>
      </div>
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
