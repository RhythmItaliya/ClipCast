"use client";

import {
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import { useCallback } from "react";
import type { QueueFile } from "~/components/dashboard/queue-table";

/**
 * The one shared server-state query for the whole dashboard: credits, usage
 * gates, and the queue list, straight from /api/queue-status.
 *
 * Every consumer passes a `select` for just the slice it renders (credits,
 * files, ...). Combined with TanStack Query's structural sharing, that means
 * a poll tick where nothing changed re-renders nothing, and a queue-only
 * change doesn't touch credit displays (and vice versa).
 */

export type QueueStatusData = {
  uploadedFiles: QueueFile[];
  credits: number;
  uploadsToday: number;
  activeJobs: number;
};

export const QUEUE_STATUS_KEY = ["queue-status"] as const;

async function fetchQueueStatus(): Promise<QueueStatusData> {
  const res = await fetch("/api/queue-status");
  if (!res.ok) {
    throw new Error(`queue-status failed (HTTP ${res.status})`);
  }
  return (await res.json()) as QueueStatusData;
}

export function useQueueStatus<T>(
  select: (data: QueueStatusData) => T,
): UseQueryResult<T> {
  return useQuery({
    queryKey: QUEUE_STATUS_KEY,
    queryFn: fetchQueueStatus,
    select,
    // Adaptive polling: 10s while a job is queued/processing and fresh
    // (fast feedback during the download phase), 30s once it's been
    // processing a while (GPU renders take minutes), 20s idle heartbeat.
    // Runs only while a component subscribes, and pauses in hidden tabs
    // (refetchIntervalInBackground defaults to false).
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return 20_000;
      const active = data.uploadedFiles.filter(
        (f) => f.status === "queued" || f.status === "processing",
      );
      if (active.length === 0) return 20_000;
      const oldest = Math.min(
        ...active.map((f) => new Date(f.updatedAt).getTime()),
      );
      return Date.now() - oldest < 2 * 60 * 1000 ? 10_000 : 30_000;
    },
  });
}

/** Marks the queue-status data stale and refetches it now — call after any
 * mutation that changes credits or the queue (job submitted, cleared,
 * retried, cancelled) so every subscribed section updates, without a
 * whole-page router.refresh(). */
export function useRefreshQueueStatus(): () => Promise<boolean> {
  const queryClient = useQueryClient();
  return useCallback(async () => {
    try {
      await queryClient.refetchQueries({ queryKey: QUEUE_STATUS_KEY });
      return (
        queryClient.getQueryState(QUEUE_STATUS_KEY)?.status === "success"
      );
    } catch {
      return false;
    }
  }, [queryClient]);
}
