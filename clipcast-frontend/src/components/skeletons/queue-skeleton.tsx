import { Skeleton } from "~/components/ui/skeleton";

export function QueueSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="space-y-1.5">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-3 w-56" />
        </div>
        <Skeleton className="h-7 w-24 rounded-full" />
      </div>
      <div className="overflow-hidden rounded-3xl border border-border bg-surface/60">
        <div className="border-b border-border bg-background/40 px-5 py-3">
          <Skeleton className="h-3 w-40" />
        </div>
        <div className="divide-y divide-border">
          {Array.from({ length: rows }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-5 py-3">
              <Skeleton className="size-9 shrink-0 rounded-xl" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3 w-2/3" />
                <Skeleton className="h-2.5 w-1/3" />
              </div>
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-5 w-20 rounded-full" />
              <Skeleton className="h-3 w-14" />
              <Skeleton className="size-8 rounded-lg" />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
