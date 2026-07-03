import { PricingSkeleton, CardSkeleton } from "~/components/skeletons";

export default function Loading() {
  return (
    <div className="space-y-10">
      <div className="flex flex-col items-center gap-4">
        <CardSkeleton height="h-8" />
        <CardSkeleton height="h-10" />
        <CardSkeleton height="h-4" />
      </div>
      <PricingSkeleton />
      <CardSkeleton height="h-48" />
    </div>
  );
}
