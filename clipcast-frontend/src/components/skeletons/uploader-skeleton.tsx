import { Skeleton } from "~/components/ui/skeleton";

export function UploaderSkeleton() {
  return (
    <section className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="overflow-hidden rounded-3xl border border-border bg-surface/60">
        <div className="flex items-center gap-4 border-b border-border px-4 py-3">
          <Skeleton className="h-6 w-28" />
          <Skeleton className="h-6 w-28" />
          <Skeleton className="ml-auto h-5 w-32" />
        </div>
        <div className="space-y-4 p-5">
          <Skeleton className="h-7 w-64 rounded-full" />
          <Skeleton className="h-40 w-full rounded-2xl" />
          <div className="flex justify-between">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-9 w-32 rounded-full" />
          </div>
        </div>
      </div>
      <aside className="space-y-4">
        <div className="rounded-3xl border border-border bg-surface/60 p-5">
          <Skeleton className="h-3 w-24" />
          <div className="mt-3 space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="flex items-center gap-3 rounded-xl bg-background/50 p-2.5"
              >
                <Skeleton className="size-10 rounded-lg" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3 w-3/4" />
                  <Skeleton className="h-2.5 w-12" />
                </div>
              </div>
            ))}
          </div>
        </div>
        <Skeleton className="h-20 w-full rounded-3xl" />
      </aside>
    </section>
  );
}
