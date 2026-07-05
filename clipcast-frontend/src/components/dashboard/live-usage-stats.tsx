"use client";

import { Activity, Coins, TrendingUp } from "lucide-react";
import Link from "next/link";
import { memo, type ReactNode } from "react";
import { LIMITS } from "~/lib/limits";
import { useQueueStatus } from "~/hooks/use-queue-status";

/** Hero credits pill — subscribes to credits only, so a queue update or an
 * unchanged poll tick doesn't touch it. */
export function CreditsLeftLink() {
  const { data: credits = 0 } = useQueueStatus((d) => d.credits);
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
  const { data: uploadsToday = 0 } = useQueueStatus((d) => d.uploadsToday);
  const { data: activeJobs = 0 } = useQueueStatus((d) => d.activeJobs);
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

const StatTile = memo(function StatTile({
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
});
