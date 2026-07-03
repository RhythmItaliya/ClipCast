import { Skeleton } from "~/components/ui/skeleton";

export function HeroSkeleton() {
  return (
    <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <div className="relative overflow-hidden rounded-3xl border border-border bg-surface/60 p-5 lg:col-span-2">
        <div className="flex h-full flex-col justify-between gap-4">
          <Skeleton className="h-4 w-40" />
          <div className="space-y-2">
            <Skeleton className="h-7 w-3/4" />
            <Skeleton className="h-7 w-1/2" />
            <Skeleton className="h-4 w-2/3" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-9 w-32 rounded-full" />
            <Skeleton className="h-9 w-36 rounded-full" />
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1">
        <StatSkeleton />
        <StatSkeleton />
      </div>
    </section>
  );
}

function StatSkeleton() {
  return (
    <div className="rounded-3xl border border-border bg-surface/60 p-4">
      <div className="flex items-center justify-between">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="size-7 rounded-lg" />
      </div>
      <Skeleton className="mt-3 h-8 w-16" />
    </div>
  );
}
