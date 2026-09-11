import { Film } from "lucide-react";
import { getAdminClips } from "~/actions/admin";
import { ClipsTable } from "~/components/admin/clips-table";

/**
 * Admin clips — paginated table of every rendered clip across all users.
 * Deleting here removes the DB record only; the S3 file is left in place.
 */
export default async function AdminClipsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageParam } = await searchParams;
  const page = Math.max(1, parseInt(pageParam ?? "1", 10) || 1);

  const { clips, total, pageSize } = await getAdminClips(page, 30);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Clips</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Every rendered clip across all users. Delete records (S3 files are not removed).
          </p>
        </div>
        <div className="bg-brand-soft text-brand flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold">
          <Film className="size-4" />
          {total.toLocaleString()} total
        </div>
      </div>

      <ClipsTable clips={clips} total={total} page={page} pageSize={pageSize} />
    </div>
  );
}
