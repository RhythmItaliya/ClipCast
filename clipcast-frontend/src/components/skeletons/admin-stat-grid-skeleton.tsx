import { Skeleton } from "~/components/ui/skeleton";

/** Covers the Overview page's stat-card grid and Billing's stat cards. */
export function AdminStatGridSkeleton({
  count = 6,
  showHeader = true,
}: {
  count?: number;
  showHeader?: boolean;
}) {
  return (
    <div className="space-y-6">
      {showHeader && (
        <div className="space-y-2">
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-4 w-80" />
        </div>
      )}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className="border-border bg-surface/60 rounded-3xl border p-5">
            <div className="flex items-center justify-between">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="size-7 rounded-lg" />
            </div>
            <Skeleton className="mt-3 h-8 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}
