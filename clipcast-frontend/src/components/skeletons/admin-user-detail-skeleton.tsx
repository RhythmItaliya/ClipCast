import { Skeleton } from "~/components/ui/skeleton";

export function AdminUserDetailSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-4 w-28" />

      <div className="border-border bg-surface/60 rounded-3xl border p-6">
        <div className="flex items-center gap-4">
          <Skeleton className="size-16 shrink-0 rounded-full" />
          <div className="space-y-2">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-52" />
          </div>
        </div>
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-2xl" />
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="border-border bg-surface/60 rounded-3xl border p-5">
            <Skeleton className="mb-3 h-4 w-28" />
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, j) => (
                <Skeleton key={j} className="h-8 w-full" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
