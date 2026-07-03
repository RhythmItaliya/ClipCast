import { ProfileSkeleton, CardSkeleton } from "~/components/skeletons";

export default function Loading() {
  return (
    <div className="space-y-5">
      <ProfileSkeleton />
      <CardSkeleton height="h-64" />
      <CardSkeleton height="h-32" />
    </div>
  );
}
