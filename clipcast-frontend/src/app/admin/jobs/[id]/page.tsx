import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdminJob } from "~/actions/admin";
import { ProductionRoom } from "~/components/dashboard/production-room";
import type { ProductionLogEntry } from "~/types";

export const metadata = { title: "Job detail — Admin" };

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-muted-foreground text-[11px] font-semibold tracking-widest uppercase">
        {label}
      </div>
      <div className="mt-0.5 truncate text-sm">{value ?? "—"}</div>
    </div>
  );
}

export default async function AdminJobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const job = await getAdminJob(id);
  if (!job) notFound();

  const entries = Array.isArray(job.productionLog)
    ? (job.productionLog as unknown as ProductionLogEntry[])
    : [];

  return (
    <div className="space-y-6">
      <Link
        href="/admin/jobs"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm"
      >
        <ArrowLeft className="size-4" /> All jobs
      </Link>

      {/* WHO / WHAT / WHEN / status */}
      <div className="border-border bg-surface/40 rounded-3xl border p-5">
        <div className="flex items-center justify-between gap-3">
          <h1 className="truncate text-lg font-semibold tracking-tight">
            {job.displayName ?? "Untitled job"}
          </h1>
          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${
              job.status === "failed"
                ? "bg-destructive/10 text-destructive"
                : job.status === "processed"
                  ? "bg-brand-soft text-brand"
                  : "bg-muted text-muted-foreground"
            }`}
          >
            {job.status}
          </span>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          <Field label="Who (user)" value={job.user?.email} />
          <Field label="Type" value={job.jobType ?? "clip"} />
          <Field
            label="Mode"
            value={job.audioMode ?? job.clipMode ?? "—"}
          />
          <Field label="Genre" value={job.audioGenre ?? "—"} />
          <Field label="Clips" value={job._count.clips} />
          <Field
            label="Duration"
            value={job.duration ? `${job.duration}s` : "—"}
          />
          <Field
            label="When"
            value={new Date(job.createdAt).toLocaleString()}
          />
          <Field
            label="Updated"
            value={new Date(job.updatedAt).toLocaleString()}
          />
        </div>
        {job.youtubeUrl && (
          <div className="mt-4">
            <Field label="Source" value={job.youtubeUrl} />
          </div>
        )}
      </div>

      {/* HOW — the processing summary (which models/services ran) */}
      {job.processingSummary && (
        <div className="border-border bg-surface/40 rounded-3xl border p-5">
          <div className="text-muted-foreground text-[11px] font-semibold tracking-widest uppercase">
            How — processing summary
          </div>
          <p className="mt-2 text-sm break-words">{job.processingSummary}</p>
        </div>
      )}

      {/* WHY it failed — full error context for debugging */}
      {(job.errorMessage || job.internalErrorDetail) && (
        <div className="border-destructive/30 bg-destructive/5 rounded-3xl border p-5">
          <div className="text-destructive text-[11px] font-semibold tracking-widest uppercase">
            Error — why it failed
          </div>
          {job.errorMessage && (
            <p className="mt-2 text-sm">{job.errorMessage}</p>
          )}
          {job.internalErrorDetail && (
            <pre className="text-muted-foreground mt-3 max-h-64 overflow-auto rounded-xl bg-black/20 p-3 text-xs whitespace-pre-wrap">
              {job.internalErrorDetail}
            </pre>
          )}
        </div>
      )}

      {/* WHAT the crew decided, step by step (role, model vs fallback, why) */}
      <ProductionRoom title={job.displayName ?? "this job"} entries={entries} />
    </div>
  );
}
