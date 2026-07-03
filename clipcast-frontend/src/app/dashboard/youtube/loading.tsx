import { CardSkeleton } from "~/components/skeletons";

export default function Loading() {
  return (
    <div className="space-y-5">
      <CardSkeleton height="h-56" />
      <CardSkeleton height="h-40" />
      <CardSkeleton height="h-32" />
    </div>
  );
}
