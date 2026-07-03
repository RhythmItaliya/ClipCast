import { Skeleton } from "~/components/ui/skeleton";

export function ClipsGridSkeleton({ groups = 3 }: { groups?: number }) {
  return (
    <div className="space-y-4">
      {Array.from({ length: groups }).map((_, i) => (
        <div
          key={i}
          className="rounded-3xl border border-border bg-surface/40 px-5 py-4"
        >
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Skeleton className="size-10 rounded-2xl" />
              <div className="space-y-2">
                <Skeleton className="h-3.5 w-40" />
                <Skeleton className="h-3 w-24" />
              </div>
            </div>
            <Skeleton className="size-4 rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}
