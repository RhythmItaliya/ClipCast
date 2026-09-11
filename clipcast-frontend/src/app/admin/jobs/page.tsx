import { ListChecks } from "lucide-react";
import { getAdminJobs } from "~/actions/admin";
import { JobsTable } from "~/components/admin/jobs-table";

/**
 * Admin jobs — paginated table of every processing job, with an optional
 * ?status filter. Used to monitor progress and cancel stuck jobs.
 */
export default async function AdminJobsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; status?: string }>;
}) {
  const { page: pageParam, status } = await searchParams;
  const page = Math.max(1, parseInt(pageParam ?? "1", 10) || 1);

  // Only pass valid statuses; "all" means no filter
  const validStatuses = ["queued", "processing", "processed", "failed"];
  const statusFilter =
    status && validStatuses.includes(status) ? status : undefined;

  const { jobs, total, pageSize } = await getAdminJobs(page, 30, statusFilter);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Jobs</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            All processing jobs across every user. Cancel stuck jobs here.
          </p>
        </div>
        <div className="bg-brand-soft text-brand flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold">
          <ListChecks className="size-4" />
          {total.toLocaleString()} total
        </div>
      </div>

      <JobsTable
        jobs={jobs}
        total={total}
        page={page}
        pageSize={pageSize}
        statusFilter={statusFilter}
      />
    </div>
  );
}
