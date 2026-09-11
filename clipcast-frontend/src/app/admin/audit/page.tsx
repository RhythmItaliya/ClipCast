import { ScrollText } from "lucide-react";
import { getAdminAuditLog } from "~/actions/admin";
import { AuditLogTable } from "~/components/admin/audit-log-table";

/**
 * Admin audit log — paginated, read-only trail of every admin action
 * (bans, role changes, credit adjustments, resets, deletes).
 */
export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageParam } = await searchParams;
  // Parse and clamp the ?page query param to a valid 1-based page (guards NaN).
  const page = Math.max(1, parseInt(pageParam ?? "1", 10) || 1);

  const { entries, total, pageSize } = await getAdminAuditLog(page, 30);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Audit Log</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Every admin action — bans, role changes, credit adjustments, resets, deletes.
          </p>
        </div>
        <div className="bg-brand-soft text-brand flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold">
          <ScrollText className="size-4" />
          {total.toLocaleString()} total
        </div>
      </div>

      <AuditLogTable entries={entries} total={total} page={page} pageSize={pageSize} />
    </div>
  );
}
