import { Coins, CreditCard, Receipt } from "lucide-react";
import type { ReactNode } from "react";
import { getAdminPurchases, getAdminRevenueStats } from "~/actions/admin";
import { BillingTable } from "~/components/admin/billing-table";
import { formatCents } from "~/lib/utils";

/**
 * Admin billing — revenue summary stats plus a paginated table of every
 * credit-pack purchase across all users.
 */
export default async function AdminBillingPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageParam } = await searchParams;
  const page = Math.max(1, parseInt(pageParam ?? "1", 10) || 1);

  const [stats, { purchases, total, pageSize }] = await Promise.all([
    getAdminRevenueStats(),
    getAdminPurchases(page, 30),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Billing</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Revenue and credit-pack purchases across every user.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          icon={<Coins className="size-4" />}
          label="Total Revenue"
          value={formatCents(stats.totalRevenueCents)}
        />
        <StatCard
          icon={<Receipt className="size-4" />}
          label="Total Purchases"
          value={stats.totalPurchases.toLocaleString()}
        />
        <StatCard
          icon={<CreditCard className="size-4" />}
          label="Credits Sold"
          value={stats.totalCreditsSold.toLocaleString()}
        />
      </div>

      <BillingTable purchases={purchases} total={total} page={page} pageSize={pageSize} />
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="border-border bg-surface/60 rounded-3xl border p-5">
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground text-xs font-medium">{label}</span>
        <span className="bg-brand-soft text-brand grid size-7 place-items-center rounded-lg">
          {icon}
        </span>
      </div>
      <div className="mt-3">
        <span className="text-3xl font-semibold tracking-tight">{value}</span>
      </div>
    </div>
  );
}
