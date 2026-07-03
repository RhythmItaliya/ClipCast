"use client";

import {
  CloudUpload,
  Link2,
  Loader2,
  Upload,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, type DragEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { processVideo, processYoutubeVideo } from "~/actions/generation";
import { generateUploadUrl } from "~/actions/s3";
import {
  FRIENDLY_MESSAGES,
  getFriendlyErrorMessage,
  isOffline,
  messageForStatus,
} from "~/lib/errors";
import { getUsageBlockReason, LIMITS, type UsageStats } from "~/lib/limits";
import { TOAST_DURATION_LONG, TOAST_DURATION_MEDIUM } from "~/lib/utils";

const YT_REGEX = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+/;

const CLIP_MODES = [
  { id: "all", label: "All" },
  { id: "qa", label: "Q&A" },
  { id: "educational", label: "Educational" },
  { id: "motivational", label: "Motivational" },
  { id: "highlights", label: "Highlights" },
] as const;

export function Uploader({ usage }: { usage: UsageStats }) {
  const [tab, setTab] = useState<"upload" | "youtube">("upload");
  const [preview, setPreview] = useState(false);
  const [mode, setMode] = useState("all");
  const [file, setFile] = useState<File | null>(null);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // Client-side mirror of the server gates — instant feedback, server decides.
  const blockReason = getUsageBlockReason(usage);

  const pickFile = (candidate: File | undefined) => {
    if (!candidate) return;
    if (!candidate.name.toLowerCase().endsWith(".mp4")) {
      toast.error("Unsupported file", {
        description: "Please choose an MP4 video.",
      });
      return;
    }
    if (candidate.size > LIMITS.MAX_FILE_SIZE_BYTES) {
      toast.error("File too large", {
        description: `The maximum upload size is ${LIMITS.MAX_FILE_SIZE_LABEL}.`,
      });
      return;
    }
    setFile(candidate);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    if (busy) return;
    pickFile(e.dataTransfer.files?.[0]);
  };

  const handleUpload = async () => {
    if (!file || busy) return;
    if (isOffline()) {
      toast.error(FRIENDLY_MESSAGES.offline);
      return;
    }
    if (blockReason) {
      toast.error("Can't start a new job", { description: blockReason });
      return;
    }

    setBusy(true);
    try {
      const urlResult = await generateUploadUrl({
        filename: file.name,
        contentType: file.type || "video/mp4",
        size: file.size,
      });
      if (!urlResult.success) {
        toast.error("Upload blocked", { description: urlResult.error });
        return;
      }

      let uploadResponse: Response;
      try {
        uploadResponse = await fetch(urlResult.signedUrl, {
          method: "PUT",
          body: file,
          headers: { "Content-Type": file.type || "video/mp4" },
        });
      } catch (e) {
        toast.error("Upload interrupted", {
          description: getFriendlyErrorMessage(e),
        });
        return;
      }
      if (!uploadResponse.ok) {
        toast.error("Upload failed", {
          description: messageForStatus(uploadResponse.status),
        });
        return;
      }

      const processResult = await processVideo(
        urlResult.uploadedFileId,
        mode,
        preview,
      );
      setFile(null);
      if (!processResult.success) {
        toast.warning("Uploaded, but not queued", {
          description: processResult.error,
          duration: TOAST_DURATION_LONG,
        });
      } else {
        toast.success("Video uploaded successfully", {
          description:
            "Your video has been scheduled for processing. Track it in the queue.",
          duration: TOAST_DURATION_MEDIUM,
        });
      }
      router.refresh();
    } catch (e) {
      toast.error("Upload failed", { description: getFriendlyErrorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  const handleYoutube = async () => {
    const url = youtubeUrl.trim();
    if (!url || busy) return;
    if (isOffline()) {
      toast.error(FRIENDLY_MESSAGES.offline);
      return;
    }
    if (!YT_REGEX.test(url)) {
      toast.error("Invalid URL", {
        description:
          "That doesn't look like a YouTube link. Use youtube.com or youtu.be.",
      });
      return;
    }
    if (blockReason) {
      toast.error("Can't start a new job", { description: blockReason });
      return;
    }

    setBusy(true);
    try {
      const result = await processYoutubeVideo(url, mode, preview);
      if (!result.success) {
        toast.error("Could not queue video", {
          description: result.error ?? "Could not queue this YouTube video.",
        });
        return;
      }
      setYoutubeUrl("");
      toast.success("YouTube video queued!", {
        description:
          "Your video is downloading and will be processed automatically.",
        duration: TOAST_DURATION_LONG,
      });
      router.refresh();
    } catch (e) {
      toast.error("Failed to queue YouTube video", {
        description: getFriendlyErrorMessage(e),
      });
    } finally {
      setBusy(false);
    }
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) setYoutubeUrl(text.trim());
    } catch {
      toast.error("Couldn't read the clipboard", {
        description: "Paste the link into the field manually.",
      });
    }
  };

  const canGenerate =
    !busy && !blockReason && (tab === "upload" ? !!file : !!youtubeUrl.trim());

  return (
    <div className="border-border bg-surface/60 overflow-hidden rounded-3xl border">
      <div className="border-border flex items-center justify-between border-b px-4">
        <div className="flex">
          <TabButton
            active={tab === "upload"}
            onClick={() => setTab("upload")}
            icon={<Upload className="size-4" />}
          >
            Upload File
          </TabButton>
          <TabButton
            active={tab === "youtube"}
            onClick={() => setTab("youtube")}
            icon={<Link2 className="size-4" />}
          >
            YouTube URL
          </TabButton>
        </div>
        <label className="flex cursor-pointer items-center gap-2 py-3">
          <span className="relative inline-flex">
            <input
              type="checkbox"
              className="peer sr-only"
              checked={preview}
              onChange={(e) => setPreview(e.target.checked)}
              disabled={busy}
            />
            <span className="bg-surface-2 ring-border peer-checked:bg-brand h-5 w-9 rounded-full ring-1 transition-colors" />
            <span className="bg-foreground absolute top-0.5 left-0.5 size-4 rounded-full transition-transform peer-checked:translate-x-4 peer-checked:bg-white" />
          </span>
          <span className="text-muted-foreground text-xs font-medium">
            Preview mode · 480p
          </span>
        </label>
      </div>

      <div className="space-y-4 p-5">
        {blockReason && (
          <div className="border-destructive/30 bg-destructive/10 text-destructive rounded-2xl border px-4 py-3 text-sm">
            {blockReason}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground text-[11px] font-semibold tracking-widest uppercase">
            Clip mode
          </span>
          <div className="border-border bg-background flex gap-1 overflow-x-auto rounded-full border p-1">
            {CLIP_MODES.map((m) => (
              <button
                key={m.id}
                onClick={() => setMode(m.id)}
                disabled={busy}
                className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  mode === m.id
                    ? "bg-brand text-brand-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {tab === "upload" ? (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            className={`group border-border bg-background/50 rounded-2xl border-2 border-dashed p-6 transition-colors ${
              dragging ? "border-brand bg-brand-soft" : "hover:border-brand/50"
            }`}
          >
            <input
              ref={inputRef}
              type="file"
              accept="video/mp4,.mp4"
              className="hidden"
              disabled={busy}
              onChange={(e) => {
                pickFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            <div className="flex flex-col items-center gap-3 text-center">
              <div className="bg-brand-soft text-brand ring-brand/20 grid size-12 place-items-center rounded-2xl ring-1 transition-transform group-hover:-rotate-6">
                <CloudUpload className="size-6" />
              </div>
              {file ? (
                <div className="space-y-0.5">
                  <p className="flex items-center gap-2 font-medium">
                    {file.name}
                    <button
                      onClick={() => setFile(null)}
                      disabled={busy}
                      title="Remove file"
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <X className="size-4" />
                    </button>
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {(file.size / (1024 * 1024)).toFixed(1)} MB · ready to
                    generate
                  </p>
                </div>
              ) : (
                <div className="space-y-0.5">
                  <p className="font-medium">Drag & drop your podcast here</p>
                  <p className="text-muted-foreground text-xs">
                    MP4 up to {LIMITS.MAX_FILE_SIZE_LABEL} · max{" "}
                    {LIMITS.MAX_DURATION_MINUTES} min ·{" "}
                    {LIMITS.MAX_UPLOADS_PER_DAY} videos / day
                  </p>
                </div>
              )}
              <button
                onClick={() => inputRef.current?.click()}
                disabled={busy}
                className="bg-foreground text-background rounded-full px-5 py-2 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {file ? "Choose another file" : "Browse files"}
              </button>
            </div>
          </div>
        ) : (
          <div className="border-border bg-background/50 rounded-2xl border-2 border-dashed p-6">
            <div className="mx-auto max-w-xl space-y-3">
              <label className="text-muted-foreground text-[11px] font-semibold tracking-widest uppercase">
                YouTube URL
              </label>
              <div className="flex gap-2">
                <input
                  type="url"
                  value={youtubeUrl}
                  onChange={(e) => setYoutubeUrl(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleYoutube()}
                  disabled={busy}
                  placeholder="https://youtube.com/watch?v=…"
                  className="border-border bg-background focus:ring-brand/50 flex-1 rounded-xl border px-4 py-2.5 text-sm outline-none focus:ring-2"
                />
                <button
                  onClick={handlePaste}
                  disabled={busy}
                  className="bg-surface-2 ring-border hover:bg-surface rounded-xl px-4 py-2.5 text-sm font-medium ring-1"
                >
                  Paste
                </button>
              </div>
              <p className="text-muted-foreground text-xs">
                Public videos only. Age-restricted or region-blocked links may
                fail. Shorts and youtu.be links work too.
              </p>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between gap-3">
          <p className="text-muted-foreground text-xs">
            Estimated cost:{" "}
            <span className="text-foreground font-semibold">
              ~1 credit / min
            </span>
          </p>
          <button
            onClick={tab === "upload" ? handleUpload : handleYoutube}
            disabled={!canGenerate}
            className="bg-brand text-brand-foreground flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy && <Loader2 className="size-4 animate-spin" />}
            {busy
              ? tab === "upload"
                ? "Uploading…"
                : "Queuing…"
              : "Generate clips"}
          </button>
        </div>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  icon: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`-mb-px flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors ${
        active
          ? "border-brand text-foreground border-b-2"
          : "text-muted-foreground hover:text-foreground border-b-2 border-transparent"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}
