"use client";

import { Activity, Coins, TrendingUp } from "lucide-react";
import Link from "next/link";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { LIMITS } from "~/lib/limits";

/**
 * The hero credits link + "Videos today"/"Running jobs" stat tiles were
 * server-rendered once at page load from a snapshot of usage stats. Once a
 * job finished (or failed) in the background, these numbers went stale until
 * the next full page navigation, even though the queue table right below
 * them polls live and shows the correct status immediately. This provider
 * polls the same endpoint the queue table uses and recomputes all three from
 * the user's actual current jobs, so a failed/completed job is reflected
 * here too, not just in the queue rows.
 *
 * Split into a provider + two consumers because the credits link and the
 * stat tiles live in two different branches of the hero section's markup,
 * but should share a single poll rather than each running their own.
 */
type LiveUsage = { credits: number; uploadsToday: number; activeJobs: number };

const LiveUsageContext = createContext<LiveUsage | null>(null);

export function LiveUsageProvider({
  initialCredits,
  initialUploadsToday,
  initialActiveJobs,
  children,
}: {
  initialCredits: number;
  initialUploadsToday: number;
  initialActiveJobs: number;
  children: ReactNode;
}) {
  const [usage, setUsage] = useState<LiveUsage>({
    credits: initialCredits,
    uploadsToday: initialUploadsToday,
    activeJobs: initialActiveJobs,
  });

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      try {
        const res = await fetch("/api/queue-status");
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as {
          credits: number;
          uploadsToday: number;
          activeJobs: number;
        };
        // Same getUsageStats() the server-side gates use, so "Running jobs"
        // drops a job the instant it's failed/completed rather than only on
        // the next full page navigation.
        setUsage({
          credits: data.credits,
          uploadsToday: data.uploadsToday,
          activeJobs: data.activeJobs,
        });
      } catch {
        // Silent — the next poll will retry.
      }
    };

    void poll();
    const interval = setInterval(poll, 15_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

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
