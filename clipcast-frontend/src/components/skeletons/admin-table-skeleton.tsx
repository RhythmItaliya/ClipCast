import { Skeleton } from "~/components/ui/skeleton";

/** Covers the "title + badge row, then a paginated table" shape shared by the
 * admin Users/Jobs/Clips/Billing/Audit pages. */
export function AdminTableSkeleton({
  columns = 6,
  rows = 8,
}: {
  columns?: number;
  rows?: number;
}) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="h-9 w-28 rounded-full" />
      </div>

      <Skeleton className="h-4 w-48" />

      <div className="border-border overflow-hidden rounded-2xl border">
        <div className="bg-surface-2 border-border flex gap-4 border-b px-4 py-3">
          {Array.from({ length: columns }).map((_, i) => (
            <Skeleton key={i} className="h-3 w-16" />
          ))}
        </div>
        <div className="divide-border divide-y">
          {Array.from({ length: rows }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-3.5">
              {Array.from({ length: columns }).map((_, j) => (
                <Skeleton key={j} className="h-3 flex-1" />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
