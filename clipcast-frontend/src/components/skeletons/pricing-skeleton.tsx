import { Skeleton } from "~/components/ui/skeleton";

export function PricingSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          className="space-y-4 rounded-3xl border border-border bg-surface/60 p-6"
        >
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-9 w-32" />
          <div className="space-y-2">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-5/6" />
            <Skeleton className="h-3 w-4/6" />
          </div>
          <Skeleton className="h-10 w-full rounded-full" />
        </div>
      ))}
    </div>
  );
}
