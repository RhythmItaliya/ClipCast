import { Skeleton } from "~/components/ui/skeleton";

export function CardSkeleton({ height = "h-40" }: { height?: string }) {
  return <Skeleton className={`w-full rounded-3xl ${height}`} />;
}
