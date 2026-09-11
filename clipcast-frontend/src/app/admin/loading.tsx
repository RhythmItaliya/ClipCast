// Route-level loading UI — Next.js renders this loading.tsx as the Suspense
// fallback while the admin overview's server-side stats load.
import { AdminStatGridSkeleton } from "~/components/skeletons";

export default function Loading() {
  return <AdminStatGridSkeleton count={7} />;
}
