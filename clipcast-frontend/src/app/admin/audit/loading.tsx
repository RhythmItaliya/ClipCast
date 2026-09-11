// Route-level loading UI — Next.js Suspense fallback shown while the audit-log
// page's server data loads.
import { AdminTableSkeleton } from "~/components/skeletons";

export default function Loading() {
  return <AdminTableSkeleton columns={5} rows={12} />;
}
