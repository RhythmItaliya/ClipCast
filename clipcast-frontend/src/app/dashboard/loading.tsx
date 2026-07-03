import {
  HeroSkeleton,
  UploaderSkeleton,
  QueueSkeleton,
} from "~/components/skeletons";

export default function Loading() {
  return (
    <div className="space-y-5">
      <HeroSkeleton />
      <UploaderSkeleton />
      <QueueSkeleton />
    </div>
  );
}
