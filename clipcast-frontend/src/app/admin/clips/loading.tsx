// Route-level loading UI — Next.js Suspense fallback shown while the clips
// page's server data loads.
import { AdminTableSkeleton } from "~/components/skeletons";

export default function Loading() {
  return <AdminTableSkeleton columns={7} rows={10} />;
}
