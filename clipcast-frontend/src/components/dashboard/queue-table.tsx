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
import { memo, useCallback, useState } from "react";
import { toast } from "sonner";
import { clearQueueItem } from "~/actions/generation";
import { YoutubeIcon } from "~/components/brand";
import {
  fetchWithTimeout,
  FRIENDLY_MESSAGES,
  getFriendlyErrorMessage,
  isOffline,
} from "~/lib/errors";
import { TOAST_DURATION_SHORT } from "~/lib/utils";
import {
  useQueueStatus,
  useRefreshQueueStatus,
} from "~/hooks/use-queue-status";
import type { QueueFile } from "~/types";

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
  compact = false,
  title = "Queue",
  description = "Latest processing jobs across your workspace.",
  hideHeading = false,
}: {
  compact?: boolean;
  title?: string;
  description?: string;
  // On the dedicated /dashboard/queue page the shell top bar already shows the
  // "Queue" title + description, so we hide this component's own heading there
  // (the Refresh button still renders). The compact overview keeps its heading.
  hideHeading?: boolean;
}) {
  // Files and polling live in the shared queue-status query (seeded
  // server-side in dashboard/layout.tsx). This subscribes to the files
  // slice only — structural sharing keeps unchanged rows (and the whole
  // array, when nothing changed) referentially identical, so an unchanged
  // poll tick renders nothing.
  const { data: files = [] } = useQueueStatus((d) => d.uploadedFiles);
  const refresh = useRefreshQueueStatus();

  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Which specific button triggered the in-flight request, so only that one
  // shows a spinner — the row's other action button just disables instead of
  // spinning too.
  const [busyAction, setBusyAction] = useState<
    "retry" | "cancel" | "clear" | null
  >(null);

  const fetchQueueStatus = useCallback(
    async (notifyOnError = false) => {
      const ok = await refresh();
      if (!ok && notifyOnError) {
        toast.error("Couldn't refresh the queue");
      }
    },
    [refresh],
  );

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchQueueStatus(true);
    setTimeout(() => setRefreshing(false), 600);
  };

  const handleRetry = useCallback(async (fileId: string) => {
    if (isOffline()) {
      toast.error(FRIENDLY_MESSAGES.offline);
      return;
    }
    setBusyId(fileId);
    setBusyAction("retry");
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
      setBusyAction(null);
    }
  }, [fetchQueueStatus]);

  const handleCancel = useCallback(async (fileId: string) => {
    if (isOffline()) {
      toast.error(FRIENDLY_MESSAGES.offline);
      return;
    }
    setBusyId(fileId);
    setBusyAction("cancel");
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
      setBusyAction(null);
    }
  }, [fetchQueueStatus]);

  const handleClear = useCallback(async (fileId: string) => {
    setBusyId(fileId);
    setBusyAction("clear");
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
      setBusyAction(null);
    }
  }, [fetchQueueStatus]);

  const rows = compact ? files.slice(0, 3) : files;

  return (
    <section className="space-y-3">
      <div
        className={`flex items-center ${
          hideHeading ? "justify-end" : "justify-between"
        }`}
      >
        {!hideHeading && (
          <div>
            <h2 className="text-base font-semibold tracking-tight">{title}</h2>
            <p className="text-muted-foreground text-xs">{description}</p>
          </div>
        )}
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
                    busyAction={busyId === item.id ? busyAction : null}
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

// Memoized: with stable row object identity from the store's mergeFiles and
// useCallback'd handlers above, only rows whose data actually changed
// re-render when the queue updates.
const QueueRow = memo(function QueueRow({
  item,
  busy,
  busyAction,
  onRetry,
  onCancel,
  onClear,
}: {
  item: QueueFile;
  busy: boolean;
  busyAction: "retry" | "cancel" | "clear" | null;
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

  // Only surface errorMessage for jobs that are actually in an error state.
  // A job can carry a leftover errorMessage from an earlier failed attempt
  // even after it later succeeds (stale data from before this row's status
  // last changed), so status is the source of truth for whether to show it.
  const showError =
    (item.status === "failed" || item.status === "no credits") &&
    !!item.errorMessage;
  const detail = showError
    ? item.errorMessage
    : [item.isPreview ? "Preview · 480p" : null, item.clipMode]
        .filter(Boolean)
        .join(" · ");

  return (
    <tr className="hover:bg-background/40">
      <td className="max-w-[300px] px-5 py-3">
        <div className="flex items-center gap-3">
          <div className="bg-background ring-border grid size-9 shrink-0 place-items-center rounded-xl ring-1">
            {item.status === "failed" || item.status === "no credits" ? (
              item.sourceUrls.length > 0 ? (
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
              {item.sourceUrls.length === 1 && (
                <a
                  href={item.sourceUrls[0]}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 text-red-500 transition-colors hover:text-red-400"
                  title="Open the source video"
                >
                  <Play className="size-3.5 fill-current" />
                </a>
              )}
              {item.sourceUrls.length > 1 && (
                <button
                  type="button"
                  onClick={() =>
                    item.sourceUrls.forEach((url) =>
                      window.open(url, "_blank", "noopener,noreferrer"),
                    )
                  }
                  className="flex shrink-0 items-center gap-0.5 text-red-500 transition-colors hover:text-red-400"
                  title={`Open all ${item.sourceUrls.length} source videos in new tabs`}
                >
                  <Play className="size-3.5 fill-current" />
                  <span className="text-[10px] font-semibold">
                    ×{item.sourceUrls.length}
                  </span>
                </button>
              )}
            </div>
            <div
              className={`truncate text-[11px] capitalize ${
                showError
                  ? "text-destructive/80 normal-case"
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
          title={item.processingSummary ?? undefined}
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
              {busyAction === "retry" ? (
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
              {busyAction === "cancel" ? (
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
              {busyAction === "clear" ? (
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
});
