"use client";

import {
  Check,
  Clock,
  FileVideo,
  Loader2,
  Play,
  RefreshCw,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { clearQueueItem } from "~/actions/generation";
import { YoutubeIcon } from "~/components/brand";
import {
  fetchWithTimeout,
  FRIENDLY_MESSAGES,
  getFriendlyErrorMessage,
  isOffline,
  messageForStatus,
} from "~/lib/errors";
import { TOAST_DURATION_SHORT } from "~/lib/utils";

export type QueueFile = {
  id: string;
  s3Key: string;
  filename: string;
  youtubeUrl: string | null;
  status: string;
  clipMode: string | null;
  isPreview: boolean | null;
  clipsCount: number;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
};

const BADGES: Record<string, { label: string; className: string }> = {
  queued: {
    label: "Queued",
    className: "bg-sky-500/10 text-sky-600 ring-sky-500/20",
  },
  processing: {
    label: "Processing",
    className: "bg-amber-500/10 text-amber-600 ring-amber-500/20",
  },
  processed: {
    label: "Completed",
    className: "bg-brand-soft text-brand ring-brand/20",
  },
  failed: {
    label: "Failed",
    className: "bg-destructive/10 text-destructive ring-destructive/20",
  },
  "no credits": {
    label: "No credits",
    className: "bg-destructive/10 text-destructive ring-destructive/20",
  },
  cancelled: {
    label: "Cancelled",
    className: "bg-surface-2 text-muted-foreground ring-border",
  },
};

export function QueueTable({
  initialFiles,
  compact = false,
  title = "Queue",
  description = "Latest processing jobs across your workspace.",
}: {
  initialFiles: QueueFile[];
  compact?: boolean;
  title?: string;
  description?: string;
}) {
  const [files, setFiles] = useState<QueueFile[]>(initialFiles);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    setFiles(initialFiles);
  }, [initialFiles]);

  const fetchQueueStatus = useCallback(async (notifyOnError = false) => {
    try {
      const res = await fetchWithTimeout("/api/queue-status", {}, 15_000);
      if (res.ok) {
        const data = (await res.json()) as {
          uploadedFiles: (Omit<QueueFile, "createdAt" | "updatedAt"> & {
            createdAt: string;
            updatedAt: string;
          })[];
        };
        setFiles(
          data.uploadedFiles.map((f) => ({
            ...f,
            createdAt: new Date(f.createdAt),
            updatedAt: new Date(f.updatedAt),
          })),
        );
      } else if (notifyOnError) {
        toast.error("Couldn't refresh the queue", {
          description: messageForStatus(res.status),
        });
      }
    } catch (e) {
      // Silent during background polling; loud on manual refresh.
      if (notifyOnError) {
        toast.error("Couldn't refresh the queue", {
          description: getFriendlyErrorMessage(e),
        });
      }
    }
  }, []);

  // Auto-poll while any job is still in progress.
  // Use adaptive intervals: 10s for recently-submitted jobs (likely queued or
  // in the download phase), 30s for jobs that have been processing for a while
  // (GPU rendering can take 5-20 min — no need to hammer the DB every 10s).
  const hasActiveJobs = files.some(
    (f) => f.status === "queued" || f.status === "processing",
  );
  const oldestActiveUpdatedAt = hasActiveJobs
    ? Math.min(
        ...files
          .filter((f) => f.status === "queued" || f.status === "processing")
          .map((f) => new Date(f.updatedAt).getTime()),
      )
    : null;
  const activeJobAgeMs =
    oldestActiveUpdatedAt != null ? Date.now() - oldestActiveUpdatedAt : 0;
  // < 2 min since last status update → poll every 10s (fast feedback for downloads)
  // >= 2 min → poll every 30s (GPU processing — no rush)
  const pollIntervalMs = activeJobAgeMs < 2 * 60 * 1000 ? 10_000 : 30_000;

  useEffect(() => {
    if (!hasActiveJobs) return;
    const interval = setInterval(() => void fetchQueueStatus(), pollIntervalMs);
    return () => clearInterval(interval);
  }, [hasActiveJobs, pollIntervalMs, fetchQueueStatus]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchQueueStatus(true);
    router.refresh();
    setTimeout(() => setRefreshing(false), 600);
  };

  const handleRetry = async (fileId: string) => {
    if (isOffline()) {
      toast.error(FRIENDLY_MESSAGES.offline);
      return;
    }
    setBusyId(fileId);
    try {
      const res = await fetchWithTimeout("/api/reset-stuck-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileId }),
      });
      const data = (await res.json()) as { reset: number; message: string };
      if (res.ok && data.reset > 0) {
        toast.success("Job re-queued!", {
          description: "The job has been reset and will process again.",
          duration: TOAST_DURATION_SHORT,
        });
        await fetchQueueStatus();
      } else {
        toast.error("Could not retry", {
          description: data.message ?? "The job may have already completed.",
        });
      }
    } catch (e) {
      toast.error("Retry failed", { description: getFriendlyErrorMessage(e) });
    } finally {
      setBusyId(null);
    }
  };

  const handleCancel = async (fileId: string) => {
    if (isOffline()) {
      toast.error(FRIENDLY_MESSAGES.offline);
      return;
    }
    setBusyId(fileId);
    try {
      const res = await fetchWithTimeout("/api/cancel-job", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileId }),
      });
      const data = (await res.json()) as {
        cancelled?: boolean;
        message?: string;
        error?: string;
      };
      if (res.ok && data.cancelled) {
        toast.success("Job cancelled", {
          description: "The processing job has been stopped.",
          duration: TOAST_DURATION_SHORT,
        });
        await fetchQueueStatus();
      } else {
        toast.error("Could not cancel", {
          description:
            data.error ?? data.message ?? "The job may have already completed.",
        });
      }
    } catch (e) {
      toast.error("Cancel failed", { description: getFriendlyErrorMessage(e) });
    } finally {
      setBusyId(null);
    }
  };

  const handleClear = async (fileId: string) => {
    setBusyId(fileId);
    try {
      const res = await clearQueueItem(fileId);
      if (res.success) {
        toast.success("Job cleared from queue.");
        await fetchQueueStatus();
      } else {
        toast.error(res.error ?? "Could not clear job.");
      }
    } catch (e) {
      toast.error("Failed to clear queue item.", {
        description: getFriendlyErrorMessage(e),
      });
    } finally {
      setBusyId(null);
    }
  };

  const rows = compact ? files.slice(0, 3) : files;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold tracking-tight">{title}</h2>
          <p className="text-muted-foreground text-xs">{description}</p>
        </div>
        <div className="flex items-center gap-2">
          {compact && (
            <Link
              href="/dashboard/queue"
              className="border-border bg-surface hover:bg-surface-2 flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium"
            >
              View all
            </Link>
          )}
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="border-border bg-surface hover:bg-surface-2 flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium disabled:opacity-60"
          >
            {refreshing ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}{" "}
            Refresh
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="border-border bg-surface/40 grid place-items-center rounded-3xl border border-dashed px-6 py-14 text-center">
          <div className="bg-brand-soft text-brand grid size-12 place-items-center rounded-2xl">
            <Clock className="size-5" />
          </div>
          <h3 className="mt-4 text-base font-semibold">Queue is empty</h3>
          <p className="text-muted-foreground mt-1 max-w-sm text-sm">
            Upload a podcast or paste a YouTube link on the Overview page to
            start a job.
          </p>
        </div>
      ) : (
        <div className="border-border bg-surface/60 overflow-hidden rounded-3xl border">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-border bg-background/40 text-muted-foreground border-b text-[11px] font-semibold tracking-widest uppercase">
                  <th className="px-5 py-3">Source</th>
                  <th className="px-5 py-3">Uploaded</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">Clips</th>
                  <th className="px-5 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-border divide-y text-sm">
                {rows.map((item) => (
                  <QueueRow
                    key={item.id}
                    item={item}
                    busy={busyId === item.id}
                    onRetry={handleRetry}
                    onCancel={handleCancel}
                    onClear={handleClear}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

function QueueRow({
  item,
  busy,
  onRetry,
  onCancel,
  onClear,
}: {
  item: QueueFile;
  busy: boolean;
  onRetry: (id: string) => void;
  onCancel: (id: string) => void;
  onClear: (id: string) => void;
}) {
  const badge = BADGES[item.status] ?? {
    label: item.status,
    className: "bg-surface-2 text-muted-foreground ring-border",
  };
  const active = item.status === "queued" || item.status === "processing";
  const showRetry = item.status === "failed" || item.status === "cancelled";

  const detail =
    item.errorMessage ??
    [item.isPreview ? "Preview · 480p" : null, item.clipMode]
      .filter(Boolean)
      .join(" · ");

  return (
    <tr className="hover:bg-background/40">
      <td className="max-w-[300px] px-5 py-3">
        <div className="flex items-center gap-3">
          <div className="bg-background ring-border grid size-9 shrink-0 place-items-center rounded-xl ring-1">
            {item.status === "failed" || item.status === "no credits" ? (
              item.youtubeUrl ? (
                <YoutubeIcon className="text-destructive size-4" />
              ) : (
                <FileVideo className="text-destructive size-4" />
              )
            ) : active ? (
              <Loader2 className="size-4 animate-spin text-amber-500" />
            ) : (
              <Check className="text-brand size-4" />
            )}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-sm font-medium">
                {item.filename}
              </span>
              {item.youtubeUrl && (
                <a
                  href={item.youtubeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 text-red-500 transition-colors hover:text-red-400"
                  title="Open original YouTube video"
                >
                  <Play className="size-3.5 fill-current" />
                </a>
              )}
            </div>
            <div
              className={`truncate text-[11px] capitalize ${
                item.errorMessage
                  ? "text-destructive normal-case"
                  : "text-muted-foreground"
              }`}
            >
              {detail || "—"}
            </div>
          </div>
        </div>
      </td>
      <td className="text-muted-foreground px-5 py-3 text-sm whitespace-nowrap">
        {new Date(item.createdAt).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
          year: "numeric",
        })}
      </td>
      <td className="px-5 py-3">
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold tracking-widest uppercase ring-1 ${badge.className}`}
        >
          {active && <Loader2 className="size-2.5 animate-spin" />}
          {badge.label}
        </span>
      </td>
      <td className="text-muted-foreground px-5 py-3 text-sm">
        {item.status === "processed" ? (
          <span className="text-foreground font-medium">
            {item.clipsCount} clip{item.clipsCount !== 1 ? "s" : ""}
          </span>
        ) : active ? (
          "Pending…"
        ) : (
          "—"
        )}
      </td>
      <td className="px-5 py-3 text-right">
        <div className="inline-flex items-center gap-1">
          {showRetry && (
            <button
              onClick={() => onRetry(item.id)}
              disabled={busy}
              title="Retry job"
              className="text-muted-foreground hover:bg-surface-2 hover:text-foreground grid size-8 place-items-center rounded-lg disabled:opacity-50"
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RotateCcw className="size-4" />
              )}
            </button>
          )}
          {active ? (
            <button
              onClick={() => onCancel(item.id)}
              disabled={busy}
              title="Cancel job"
              className="text-muted-foreground hover:bg-surface-2 hover:text-destructive grid size-8 place-items-center rounded-lg disabled:opacity-50"
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <X className="size-4" />
              )}
            </button>
          ) : (
            <button
              onClick={() => onClear(item.id)}
              disabled={busy}
              title="Clear from queue"
              className="text-muted-foreground hover:bg-surface-2 hover:text-destructive grid size-8 place-items-center rounded-lg disabled:opacity-50"
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Trash2 className="size-4" />
              )}
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}
