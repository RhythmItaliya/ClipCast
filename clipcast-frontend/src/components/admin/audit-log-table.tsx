import Link from "next/link";

export type AdminAuditEntry = {
  id: string;
  adminEmail: string;
  action: string;
  targetType: string;
  targetId: string | null;
  detail: string | null;
  createdAt: Date;
};

// Per-action badge colors; unknown actions fall back to a neutral badge.
const ACTION_STYLES: Record<string, string> = {
  "credits.adjust": "bg-brand-soft text-brand",
  "user.ban": "bg-destructive/10 text-destructive",
  "user.unban": "bg-green-500/10 text-green-600",
  "user.promote": "bg-brand-soft text-brand",
  "user.demote": "bg-destructive/10 text-destructive",
  "job.reset": "bg-yellow-500/10 text-yellow-600",
  "job.reset_all": "bg-yellow-500/10 text-yellow-600",
  "clip.delete": "bg-destructive/10 text-destructive",
};

/**
 * Admin audit-log table: paginated, read-only trail of every admin action
 * (who did it, target, detail, when). Presentational server component — the
 * only interactivity is the prev/next page links.
 */
export function AuditLogTable({
  entries,
  total,
  page,
  pageSize,
}: {
  entries: AdminAuditEntry[];
  total: number;
  page: number;
  pageSize: number;
}) {
  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">
        {total.toLocaleString()} action{total !== 1 ? "s" : ""} — page {page} of{" "}
        {totalPages || 1}
      </p>

      <div className="border-border overflow-hidden rounded-2xl border">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 border-border border-b">
              <tr>
                {["Admin", "Action", "Target", "Detail", "Date"].map((h) => (
                  <th
                    key={h}
                    className="text-muted-foreground px-4 py-3 text-left text-xs font-semibold tracking-wide"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {entries.map((e) => (
                <tr key={e.id} className="hover:bg-surface/50 transition-colors">
                  <td className="text-muted-foreground px-4 py-3 text-xs">{e.adminEmail}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                        ACTION_STYLES[e.action] ?? "bg-muted text-muted-foreground"
                      }`}
                    >
                      {e.action}
                    </span>
                  </td>
                  <td className="text-muted-foreground px-4 py-3 text-xs">
                    {e.targetType === "user" && e.targetId ? (
                      <Link href={`/admin/users/${e.targetId}`} className="hover:underline">
                        {e.targetType}:{e.targetId.slice(0, 8)}
                      </Link>
                    ) : (
                      `${e.targetType}${e.targetId ? `:${e.targetId.slice(0, 8)}` : ""}`
                    )}
                  </td>
                  <td className="text-muted-foreground max-w-[240px] truncate px-4 py-3 text-xs">
                    {e.detail ?? "—"}
                  </td>
                  <td className="text-muted-foreground px-4 py-3 text-xs whitespace-nowrap">
                    {new Date(e.createdAt).toLocaleString()}
                  </td>
                </tr>
              ))}
              {entries.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-muted-foreground py-12 text-center text-sm">
                    No admin activity yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <Link
            aria-disabled={page <= 1}
            href={`/admin/audit?page=${Math.max(1, page - 1)}`}
            className="border-border bg-surface aria-disabled:pointer-events-none aria-disabled:opacity-40 rounded-lg border px-4 py-2 text-sm font-medium transition-opacity hover:opacity-80"
          >
            Previous
          </Link>
          <span className="text-muted-foreground text-sm">
            Page {page} / {totalPages}
          </span>
          <Link
            aria-disabled={page >= totalPages}
            href={`/admin/audit?page=${Math.min(totalPages, page + 1)}`}
            className="border-border bg-surface aria-disabled:pointer-events-none aria-disabled:opacity-40 rounded-lg border px-4 py-2 text-sm font-medium transition-opacity hover:opacity-80"
          >
            Next
          </Link>
        </div>
      )}
    </div>
  );
}
