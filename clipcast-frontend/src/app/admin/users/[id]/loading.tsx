// Route-level loading UI — Next.js Suspense fallback shown while a user's
// detail page loads.
import { AdminUserDetailSkeleton } from "~/components/skeletons";

export default function Loading() {
  return <AdminUserDetailSkeleton />;
}
