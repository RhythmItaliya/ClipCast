import {
  Activity,
  AlertTriangle,
  Coins,
  Film,
  ListChecks,
  ShieldOff,
  Users,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { getAdminRevenueStats, getAdminStats } from "~/actions/admin";
import { formatCents } from "~/lib/utils";

export default async function AdminOverviewPage() {
  const [stats, revenue] = await Promise.all([getAdminStats(), getAdminRevenueStats()]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Platform Overview</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Live snapshot of all users, jobs, and clips on ClipCast.
        </p>
      </div>

      {/* Stat grid */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatCard
          icon={<Users className="size-4" />}
          label="Total Users"
          value={stats.totalUsers}
          href="/admin/users"
          accent="brand"
        />
        <StatCard
          icon={<Film className="size-4" />}
          label="Total Clips"
          value={stats.totalClips}
          href="/admin/clips"
          accent="brand"
        />
        <StatCard
          icon={<ListChecks className="size-4" />}
          label="Total Jobs"
          value={stats.totalJobs}
          href="/admin/jobs"
          accent="brand"
        />
        <StatCard
          icon={<Activity className="size-4" />}
          label="Active Jobs"
          value={stats.activeJobs}
          href="/admin/jobs?status=processing"
          accent={stats.activeJobs > 0 ? "warn" : "brand"}
        />
        <StatCard
          icon={<AlertTriangle className="size-4" />}
          label="Failed Jobs"
          value={stats.failedJobs}
          href="/admin/jobs?status=failed"
          accent={stats.failedJobs > 0 ? "destructive" : "brand"}
        />
        <StatCard
          icon={<ShieldOff className="size-4" />}
          label="Banned Users"
          value={stats.bannedUsers}
          href="/admin/users"
          accent={stats.bannedUsers > 0 ? "destructive" : "brand"}
        />
        <StatCard
          icon={<Coins className="size-4" />}
          label="Total Revenue"
          value={formatCents(revenue.totalRevenueCents)}
          href="/admin/billing"
          accent="brand"
        />
      </div>

      {/* Quick links */}
      <div className="border-border bg-surface/60 rounded-3xl border p-5">
        <p className="text-muted-foreground mb-4 text-xs font-semibold tracking-widest uppercase">
          Quick Actions
        </p>
        <div className="flex flex-wrap gap-3">
          <QuickLink href="/admin/users" label="Manage Users" icon={<Users className="size-3.5" />} />
          <QuickLink href="/admin/jobs" label="View All Jobs" icon={<ListChecks className="size-3.5" />} />
          <QuickLink href="/admin/clips" label="View All Clips" icon={<Film className="size-3.5" />} />
          <QuickLink
            href="/admin/jobs?status=processing"
            label="Active Jobs"
            icon={<Activity className="size-3.5" />}
          />
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

type Accent = "brand" | "warn" | "destructive";

function StatCard({
  icon,
  label,
  value,
  href,
  accent,
}: {
  icon: ReactNode;
  label: string;
  value: number | string;
  href: string;
  accent: Accent;
}) {
  const accentClasses: Record<Accent, string> = {
    brand: "bg-brand-soft text-brand",
    warn: "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400",
    destructive: "bg-destructive/10 text-destructive",
  };

  return (
    <Link
      href={href}
      className="border-border bg-surface/60 hover:bg-surface group rounded-3xl border p-5 transition-colors"
    >
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground text-xs font-medium">{label}</span>
        <span className={`grid size-7 place-items-center rounded-lg ${accentClasses[accent]}`}>
          {icon}
        </span>
      </div>
      <div className="mt-3">
        <span className="text-3xl font-semibold tracking-tight">{value.toLocaleString()}</span>
      </div>
    </Link>
  );
}

function QuickLink({
  href,
  label,
  icon,
}: {
  href: string;
  label: string;
  icon: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="border-border bg-background hover:bg-surface flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-colors"
    >
      <span className="text-brand">{icon}</span>
      {label}
    </Link>
  );
}
