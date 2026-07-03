import Link from "next/link";
import { formatCents } from "~/lib/utils";

export type AdminPurchase = {
  id: string;
  pack: string;
  credits: number;
  amountTotal: number;
  currency: string;
  createdAt: Date;
  user: { id: string; email: string; name: string | null };
};

const PACK_STYLES: Record<string, string> = {
  small: "bg-blue-500/10 text-blue-600",
  medium: "bg-brand-soft text-brand",
  large: "bg-purple-500/10 text-purple-600",
};

export function BillingTable({
  purchases,
  total,
  page,
  pageSize,
}: {
  purchases: AdminPurchase[];
  total: number;
  page: number;
  pageSize: number;
}) {
  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">
        {total.toLocaleString()} purchase{total !== 1 ? "s" : ""} — page {page} of{" "}
        {totalPages || 1}
      </p>

      <div className="border-border overflow-hidden rounded-2xl border">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 border-border border-b">
              <tr>
                {["Buyer", "Pack", "Credits", "Amount", "Date"].map((h) => (
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
              {purchases.map((p) => (
                <tr key={p.id} className="hover:bg-surface/50 transition-colors">
                  <td className="px-4 py-3">
                    <Link href={`/admin/users/${p.user.id}`} className="text-xs hover:underline">
                      <div className="font-medium">
                        {p.user.name ?? p.user.email.split("@")[0]}
                      </div>
                      <div className="text-muted-foreground">{p.user.email}</div>
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${
                        PACK_STYLES[p.pack] ?? "bg-muted text-muted-foreground"
                      }`}
                    >
                      {p.pack}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm">{p.credits.toLocaleString()}</td>
                  <td className="px-4 py-3 text-sm font-medium">
                    {formatCents(p.amountTotal, p.currency)}
                  </td>
                  <td className="text-muted-foreground px-4 py-3 text-xs">
                    {new Date(p.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
              {purchases.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-muted-foreground py-12 text-center text-sm">
                    No purchases yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {totalPages > 1 && (
        <Pagination page={page} totalPages={totalPages} basePath="/admin/billing" />
      )}
    </div>
  );
}

function Pagination({
  page,
  totalPages,
  basePath,
}: {
  page: number;
  totalPages: number;
  basePath: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <Link
        aria-disabled={page <= 1}
        href={`${basePath}?page=${Math.max(1, page - 1)}`}
        className="border-border bg-surface aria-disabled:pointer-events-none aria-disabled:opacity-40 rounded-lg border px-4 py-2 text-sm font-medium transition-opacity hover:opacity-80"
      >
        Previous
      </Link>
      <span className="text-muted-foreground text-sm">
        Page {page} / {totalPages}
      </span>
      <Link
        aria-disabled={page >= totalPages}
        href={`${basePath}?page=${Math.min(totalPages, page + 1)}`}
        className="border-border bg-surface aria-disabled:pointer-events-none aria-disabled:opacity-40 rounded-lg border px-4 py-2 text-sm font-medium transition-opacity hover:opacity-80"
      >
        Next
      </Link>
    </div>
  );
}
