import {
  ArrowLeft,
  Ban,
  CreditCard,
  Film,
  ListChecks,
  Receipt,
  Shield,
  User as UserIcon,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdminUserDetail } from "~/actions/admin";
import { UserDetailActions } from "~/components/admin/user-detail-actions";
import { YoutubeIcon } from "~/components/brand";
import { formatCents } from "~/lib/utils";

export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await getAdminUserDetail(id);
  if (!detail) notFound();

  const { user, jobs, clips, purchases, transactions } = detail;
  const displayName = user.name ?? user.email.split("@")[0] ?? user.email;

  return (
    <div className="space-y-6">
      <Link
        href="/admin/users"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm font-medium"
      >
        <ArrowLeft className="size-3.5" /> Back to Users
      </Link>

      {/* Profile header */}
      <div className="border-border bg-surface/60 rounded-3xl border p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="bg-brand-soft text-brand ring-background grid size-16 place-items-center rounded-full text-xl font-semibold uppercase ring-2">
              {displayName.charAt(0)}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-semibold tracking-tight">{displayName}</h2>
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
                    user.role === "ADMIN"
                      ? "bg-brand-soft text-brand"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {user.role === "ADMIN" ? (
                    <Shield className="size-2.5" />
                  ) : (
                    <UserIcon className="size-2.5" />
                  )}
                  {user.role}
                </span>
                {user.banned && (
                  <span className="bg-destructive/10 text-destructive inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold">
                    <Ban className="size-2.5" /> Banned
                  </span>
                )}
              </div>
              <p className="text-muted-foreground mt-0.5 text-sm">{user.email}</p>
              <p className="text-muted-foreground mt-1 text-xs">
                Joined {new Date(user.createdAt).toLocaleDateString()}
              </p>
            </div>
          </div>

          <UserDetailActions userId={user.id} role={user.role} banned={user.banned} />
        </div>

        {/* Quick stats */}
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MiniStat icon={<CreditCard className="size-3.5" />} label="Credits" value={user.credits} />
          <MiniStat icon={<ListChecks className="size-3.5" />} label="Jobs" value={user._count.uploadedFiles} />
          <MiniStat icon={<Film className="size-3.5" />} label="Clips" value={user._count.clips} />
          <MiniStat icon={<Receipt className="size-3.5" />} label="Purchases" value={user._count.purchases} />
        </div>

        {/* Connections */}
        <div className="border-border mt-6 flex flex-wrap gap-4 border-t pt-4 text-xs">
          <div className="text-muted-foreground flex items-center gap-1.5">
            <YoutubeIcon className="size-3.5" />
            {user.youtubeChannelName
              ? `Connected: ${user.youtubeChannelName}`
              : "No YouTube channel connected"}
          </div>
          <div className="text-muted-foreground flex items-center gap-1.5">
            <Receipt className="size-3.5" />
            {user.stripeCustomerId
              ? `Stripe customer: ${user.stripeCustomerId}`
              : "No Stripe customer yet"}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Recent jobs */}
        <section className="border-border bg-surface/60 rounded-3xl border p-5">
          <h3 className="mb-3 text-sm font-semibold">Recent jobs</h3>
          {jobs.length === 0 ? (
            <p className="text-muted-foreground py-6 text-center text-xs">No jobs yet.</p>
          ) : (
            <ul className="divide-border divide-y">
              {jobs.map((job) => (
                <li key={job.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <div className="min-w-0">
                    <div className="truncate font-medium">
                      {job.displayName ?? job.youtubeUrl ?? "—"}
                    </div>
                    <div className="text-muted-foreground text-xs">
                      {new Date(job.createdAt).toLocaleDateString()} · {job._count.clips} clip
                      {job._count.clips !== 1 ? "s" : ""}
                    </div>
                  </div>
                  <span className="text-muted-foreground shrink-0 text-xs capitalize">
                    {job.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Recent clips */}
        <section className="border-border bg-surface/60 rounded-3xl border p-5">
          <h3 className="mb-3 text-sm font-semibold">Recent clips</h3>
          {clips.length === 0 ? (
            <p className="text-muted-foreground py-6 text-center text-xs">No clips yet.</p>
          ) : (
            <ul className="divide-border divide-y">
              {clips.map((clip) => (
                <li key={clip.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <div className="min-w-0">
                    <div className="truncate font-medium capitalize">
                      {clip.s3Key.split("/").pop()?.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ")}
                    </div>
                    <div className="text-muted-foreground truncate text-xs">
                      {clip.uploadedFile?.displayName ?? "Deleted source"}
                    </div>
                  </div>
                  <span className="text-muted-foreground shrink-0 text-xs">
                    {new Date(clip.createdAt).toLocaleDateString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Purchase history */}
        <section className="border-border bg-surface/60 rounded-3xl border p-5 lg:col-span-2">
          <h3 className="mb-3 text-sm font-semibold">Purchase history</h3>
          {purchases.length === 0 ? (
            <p className="text-muted-foreground py-6 text-center text-xs">No purchases yet.</p>
          ) : (
            <ul className="divide-border divide-y">
              {purchases.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <div className="min-w-0">
                    <div className="font-medium capitalize">{p.pack} pack — {p.credits} credits</div>
                    <div className="text-muted-foreground text-xs">
                      {new Date(p.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                  <span className="font-medium">{formatCents(p.amountTotal, p.currency)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Credit ledger */}
        <section className="border-border bg-surface/60 rounded-3xl border p-5 lg:col-span-2">
          <h3 className="mb-3 text-sm font-semibold">Credit ledger</h3>
          {transactions.length === 0 ? (
            <p className="text-muted-foreground py-6 text-center text-xs">
              No credit activity yet — their current balance predates this
              ledger. New purchases, job charges, or adjustments made here
              will show up going forward.
            </p>
          ) : (
            <ul className="divide-border divide-y">
              {transactions.map((t) => (
                <li
                  key={t.id}
                  className="flex items-center justify-between gap-3 py-2.5 text-sm"
                >
                  <div className="min-w-0">
                    <div className="font-medium">
                      {t.description ?? t.type}
                    </div>
                    <div className="text-muted-foreground text-xs">
                      {new Date(t.createdAt).toLocaleDateString()} · balance
                      after: {t.balanceAfter}
                    </div>
                  </div>
                  <span
                    className={`shrink-0 font-medium ${
                      t.amount >= 0 ? "text-brand" : "text-destructive"
                    }`}
                  >
                    {t.amount >= 0 ? "+" : ""}
                    {t.amount}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function MiniStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="border-border bg-background/50 rounded-2xl border p-3">
      <div className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
        {icon} {label}
      </div>
      <div className="mt-1 text-xl font-semibold tracking-tight">{value.toLocaleString()}</div>
    </div>
  );
}
