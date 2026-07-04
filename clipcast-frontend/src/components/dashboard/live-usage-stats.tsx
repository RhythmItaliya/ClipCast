"use client";

import { Activity, Coins, TrendingUp } from "lucide-react";
import Link from "next/link";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { LIMITS } from "~/lib/limits";
import type { QueueFile } from "~/components/dashboard/queue-table";

/**
 * The hero credits link + "Videos today"/"Running jobs" stat tiles were
 * server-rendered once at page load from a snapshot of usage stats. Once a
 * job finished (or failed) in the background, these numbers went stale until
 * the next full page navigation, even though the queue table right below
 * them polls live and shows the correct status immediately. This provider
 * polls the same endpoint the queue table uses and recomputes everything
 * from the user's actual current jobs, so a failed/completed job is
 * reflected here too, not just in the queue rows.
 *
 * It also owns the raw queue file list so QueueTable can share this single
 * poll instead of running its own independent one — both used to hit
 * /api/queue-status on their own schedule, which meant every load of the
 * Overview page fired the same request twice. QueueTable still supports
 * standalone rendering by falling back to its own polling when no provider
 * is present.
 */
type LiveUsage = {
  credits: number;
  uploadsToday: number;
  activeJobs: number;
  files: QueueFile[];
  refreshing: boolean;
  refresh: () => Promise<boolean>;
};

const LiveUsageContext = createContext<LiveUsage | null>(null);

export function LiveUsageProvider({
  initialCredits,
  initialUploadsToday,
  initialActiveJobs,
  initialFiles,
  children,
}: {
  initialCredits: number;
  initialUploadsToday: number;
  initialActiveJobs: number;
  initialFiles: QueueFile[];
  children: ReactNode;
}) {
  const [credits, setCredits] = useState(initialCredits);
  const [uploadsToday, setUploadsToday] = useState(initialUploadsToday);
  const [activeJobs, setActiveJobs] = useState(initialActiveJobs);
  const [files, setFiles] = useState<QueueFile[]>(initialFiles);
  const [refreshing, setRefreshing] = useState(false);

  const poll = useCallback(async (notify = false) => {
    if (notify) setRefreshing(true);
    try {
      const res = await fetch("/api/queue-status");
      if (!res.ok) return false;
      const data = (await res.json()) as {
        uploadedFiles: (Omit<QueueFile, "createdAt" | "updatedAt"> & {
          createdAt: string;
          updatedAt: string;
        })[];
        credits: number;
        uploadsToday: number;
        activeJobs: number;
      };
      setCredits(data.credits);
      setUploadsToday(data.uploadsToday);
      setActiveJobs(data.activeJobs);
      setFiles(
        data.uploadedFiles.map((f) => ({
          ...f,
          createdAt: new Date(f.createdAt),
          updatedAt: new Date(f.updatedAt),
        })),
      );
      return true;
    } catch {
      return false;
    } finally {
      if (notify) setRefreshing(false);
    }
  }, []);

  const pollRef = useRef(poll);
  pollRef.current = poll;

  useEffect(() => {
    void pollRef.current();
    const interval = setInterval(() => void pollRef.current(), 15_000);
    return () => clearInterval(interval);
  }, []);

  const usage: LiveUsage = {
    credits,
    uploadsToday,
    activeJobs,
    files,
    refreshing,
    refresh: () => poll(true),
  };

  return (
    <LiveUsageContext.Provider value={usage}>
      {children}
    </LiveUsageContext.Provider>
  );
}

export function useLiveUsage(): LiveUsage {
  const ctx = useContext(LiveUsageContext);
  if (!ctx) {
    throw new Error("useLiveUsage must be used within a LiveUsageProvider");
  }
  return ctx;
}

/** Same as useLiveUsage, but returns null instead of throwing when there's
 * no provider — for components (like QueueTable) that work both inside and
 * outside one. */
export function useOptionalLiveUsage(): LiveUsage | null {
  return useContext(LiveUsageContext);
}

export function CreditsLeftLink() {
  const { credits } = useLiveUsage();
  return (
    <Link
      href="/dashboard/billing"
      className="border-border bg-surface hover:bg-surface-2 inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium"
    >
      <Coins className="size-3.5" /> {credits} credits left
    </Link>
  );
}

export function UsageStatTiles() {
  const { uploadsToday, activeJobs } = useLiveUsage();
  return (
    <>
      <StatTile
        icon={<TrendingUp className="size-4" />}
        label="Videos today"
        value={String(uploadsToday)}
        hint={`of ${LIMITS.MAX_UPLOADS_PER_DAY} daily`}
      />
      <StatTile
        icon={<Activity className="size-4" />}
        label="Running jobs"
        value={String(activeJobs)}
        hint={`of ${LIMITS.MAX_ACTIVE_JOBS} slots`}
      />
    </>
  );
}

function StatTile({
  icon,
  label,
  value,
  hint,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="border-border bg-surface/60 rounded-3xl border p-4">
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground text-xs font-medium">
          {label}
        </span>
        <span className="bg-brand-soft text-brand grid size-7 place-items-center rounded-lg">
          {icon}
        </span>
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-2xl font-semibold tracking-tight">{value}</span>
        <span className="text-muted-foreground text-xs">{hint}</span>
      </div>
    </div>
  );
}
