"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { resetAllStuckJobs, resetSingleJob } from "~/actions/admin";

type AdminJob = {
  id: string;
  displayName: string | null;
  youtubeUrl: string | null;
  status: string;
  clipMode: string | null;
  isPreview: boolean | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
  _count: { clips: number };
  user: { id: string; email: string; name: string | null };
};

const STATUS_STYLES: Record<string, { label: string; classes: string; icon: React.ReactNode }> = {
  queued: {
    label: "Queued",
    classes: "bg-yellow-500/10 text-yellow-600",
    icon: <Clock className="size-3" />,
  },
  processing: {
    label: "Processing",
    classes: "bg-brand-soft text-brand",
    icon: <Loader2 className="size-3 animate-spin" />,
  },
  processed: {
    label: "Done",
    classes: "bg-green-500/10 text-green-600",
    icon: <CheckCircle2 className="size-3" />,
  },
  failed: {
    label: "Failed",
    classes: "bg-destructive/10 text-destructive",
    icon: <XCircle className="size-3" />,
  },
};

export function JobsTable({
  jobs,
  total,
  page,
  pageSize,
  statusFilter,
}: {
  jobs: AdminJob[];
  total: number;
  page: number;
  pageSize: number;
  statusFilter?: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const totalPages = Math.ceil(total / pageSize);

  function handleResetAll() {
    if (!confirm("Reset ALL stuck (queued/processing) jobs to failed?")) return;
    startTransition(async () => {
      const res = await resetAllStuckJobs();
      if (res.success) {
        toast.success(`Reset ${res.count} stuck job(s).`);
        router.refresh();
      } else {
        toast.error(res.error ?? "Failed to reset jobs.");
      }
    });
  }

  function handleResetOne(jobId: string) {
    startTransition(async () => {
      const res = await resetSingleJob(jobId);
      if (res.success) {
        toast.success("Job cancelled.");
        router.refresh();
      } else {
        toast.error(res.error ?? "Failed.");
      }
    });
  }

  // Status filter tabs
  const statuses = ["all", "queued", "processing", "processed", "failed"];

  return (
    <div className="space-y-4">
      {/* Filter tabs + Reset All */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1.5 overflow-x-auto">
          {statuses.map((s) => (
            <button
              key={s}
              onClick={() =>
                router.push(
                  s === "all"
                    ? "/admin/jobs"
                    : `/admin/jobs?status=${s}`,
                )
              }
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                (statusFilter ?? "all") === s
                  ? "bg-brand text-brand-foreground"
                  : "border-border bg-surface text-muted-foreground border hover:text-foreground"
              }`}
            >
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>

        <button
          onClick={handleResetAll}
          disabled={isPending}
          className="border-destructive/30 text-destructive hover:bg-destructive/10 flex items-center gap-2 rounded-full border px-4 py-1.5 text-xs font-medium transition-colors disabled:opacity-50"
        >
          {isPending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <RefreshCw className="size-3.5" />
          )}
          Reset All Stuck
        </button>
      </div>

      <p className="text-muted-foreground text-sm">
        {total.toLocaleString()} job{total !== 1 ? "s" : ""}
        {statusFilter && statusFilter !== "all" ? ` with status "${statusFilter}"` : ""}
      </p>

      {/* Table */}
      <div className="border-border overflow-hidden rounded-2xl border">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 border-border border-b">
              <tr>
                {["Source", "User", "Status", "Mode", "Clips", "Date", "Actions"].map(
                  (h) => (
                    <th
                      key={h}
                      className="text-muted-foreground px-4 py-3 text-left text-xs font-semibold tracking-wide"
                    >
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {jobs.map((job) => {
                const statusMeta =
                  STATUS_STYLES[job.status] ?? STATUS_STYLES["failed"]!;
                const isStuck =
                  job.status === "queued" || job.status === "processing";

                return (
                  <tr key={job.id} className="hover:bg-surface/50 transition-colors">
                    {/* Source */}
                    <td className="max-w-[200px] px-4 py-3">
                      <div className="truncate font-medium">
                        {job.displayName ?? job.youtubeUrl ?? "—"}
                      </div>
                      {job.youtubeUrl && (
                        <div className="text-muted-foreground truncate text-xs">
                          YouTube
                        </div>
                      )}
                    </td>

                    {/* User */}
                    <td className="px-4 py-3">
                      <div className="text-xs">
                        <div className="font-medium">
                          {job.user.name ?? job.user.email.split("@")[0]}
                        </div>
                        <div className="text-muted-foreground">{job.user.email}</div>
                      </div>
                    </td>

                    {/* Status */}
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${statusMeta.classes}`}
                      >
                        {statusMeta.icon}
                        {statusMeta.label}
                      </span>
                      {job.errorMessage && (
                        <div
                          title={job.errorMessage}
                          className="text-destructive mt-0.5 flex items-center gap-1 text-[10px]"
                        >
                          <AlertTriangle className="size-2.5" />
                          <span className="max-w-[120px] truncate">
                            {job.errorMessage}
                          </span>
                        </div>
                      )}
                    </td>

                    {/* Mode */}
                    <td className="text-muted-foreground px-4 py-3 text-xs capitalize">
                      {job.clipMode ?? "—"}
                      {job.isPreview && (
                        <span className="ml-1 rounded bg-yellow-500/10 px-1 text-[10px] text-yellow-600">
                          preview
                        </span>
                      )}
                    </td>

                    {/* Clips */}
                    <td className="px-4 py-3 text-sm">{job._count.clips}</td>

                    {/* Date */}
                    <td className="text-muted-foreground px-4 py-3 text-xs">
                      {new Date(job.createdAt).toLocaleDateString()}
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3">
                      {isStuck && (
                        <button
                          onClick={() => handleResetOne(job.id)}
                          disabled={isPending}
                          title="Cancel this job"
                          className="border-destructive/30 text-destructive hover:bg-destructive/10 flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors disabled:opacity-50"
                        >
                          <XCircle className="size-3" /> Cancel
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {jobs.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="text-muted-foreground py-12 text-center text-sm"
                  >
                    No jobs found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <button
            disabled={page <= 1}
            onClick={() =>
              router.push(
                `/admin/jobs?page=${page - 1}${statusFilter ? `&status=${statusFilter}` : ""}`,
              )
            }
            className="border-border bg-surface disabled:opacity-40 rounded-lg border px-4 py-2 text-sm font-medium"
          >
            Previous
          </button>
          <span className="text-muted-foreground text-sm">
            Page {page} / {totalPages}
          </span>
          <button
            disabled={page >= totalPages}
            onClick={() =>
              router.push(
                `/admin/jobs?page=${page + 1}${statusFilter ? `&status=${statusFilter}` : ""}`,
              )
            }
            className="border-border bg-surface disabled:opacity-40 rounded-lg border px-4 py-2 text-sm font-medium"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
