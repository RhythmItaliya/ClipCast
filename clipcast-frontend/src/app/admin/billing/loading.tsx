import { AdminStatGridSkeleton, AdminTableSkeleton } from "~/components/skeletons";

export default function Loading() {
  return (
    <div className="space-y-6">
      <AdminStatGridSkeleton count={3} showHeader={false} />
      <AdminTableSkeleton columns={5} rows={10} />
    </div>
  );
}
