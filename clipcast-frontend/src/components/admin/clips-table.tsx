"use client";

import { Film, Loader2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { deleteAdminClip } from "~/actions/admin";

type AdminClip = {
  id: string;
  s3Key: string;
  clipMode: string;
  isPreview: boolean;
  createdAt: Date;
  user: { id: string; email: string; name: string | null };
  uploadedFile: { displayName: string | null } | null;
};

// Clip mode color accents
const MODE_STYLES: Record<string, string> = {
  qa: "bg-blue-500/10 text-blue-600",
  highlights: "bg-brand-soft text-brand",
  motivational: "bg-orange-500/10 text-orange-600",
  educational: "bg-green-500/10 text-green-600",
  all: "bg-purple-500/10 text-purple-600",
};

export function ClipsTable({
  clips,
  total,
  page,
  pageSize,
}: {
  clips: AdminClip[];
  total: number;
  page: number;
  pageSize: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const totalPages = Math.ceil(total / pageSize);

  function handleDelete(clipId: string, s3Key: string) {
    const name = s3Key.split("/").pop() ?? clipId;
    if (!confirm(`Delete clip "${name}"? This only removes the DB record, not the S3 file.`))
      return;

    startTransition(async () => {
      const res = await deleteAdminClip(clipId);
      if (res.success) {
        toast.success("Clip record deleted.");
        router.refresh();
      } else {
        toast.error(res.error ?? "Failed to delete.");
      }
    });
  }

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">
        {total.toLocaleString()} clip{total !== 1 ? "s" : ""} — page {page} of{" "}
        {totalPages}
      </p>

      {/* Table */}
      <div className="border-border overflow-hidden rounded-2xl border">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 border-border border-b">
              <tr>
                {["Clip", "Source", "Owner", "Mode", "Type", "Date", "Delete"].map(
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
              {clips.map((clip) => {
                const filename =
                  clip.s3Key.split("/").pop()?.replace(/\.[^.]+$/, "") ?? clip.id;
                const modeStyle =
                  MODE_STYLES[clip.clipMode] ?? "bg-muted text-muted-foreground";
                const displayName =
                  clip.user.name ?? clip.user.email.split("@")[0];

                return (
                  <tr
                    key={clip.id}
                    className="hover:bg-surface/50 transition-colors"
                  >
                    {/* Clip filename */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="bg-brand-soft text-brand grid size-8 shrink-0 place-items-center rounded-lg">
                          <Film className="size-3.5" />
                        </div>
                        <span className="max-w-[140px] truncate font-medium capitalize">
                          {filename.replace(/[_-]+/g, " ")}
                        </span>
                      </div>
                    </td>

                    {/* Source video */}
                    <td className="text-muted-foreground max-w-[140px] px-4 py-3 text-xs">
                      <span className="truncate block">
                        {clip.uploadedFile?.displayName ?? "Deleted"}
                      </span>
                    </td>

                    {/* Owner */}
                    <td className="px-4 py-3">
                      <div className="text-xs">
                        <div className="font-medium">{displayName}</div>
                        <div className="text-muted-foreground">
                          {clip.user.email}
                        </div>
                      </div>
                    </td>

                    {/* Mode badge */}
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${modeStyle}`}
                      >
                        {clip.clipMode}
                      </span>
                    </td>

                    {/* Preview / full */}
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                          clip.isPreview
                            ? "bg-yellow-500/10 text-yellow-600"
                            : "bg-green-500/10 text-green-600"
                        }`}
                      >
                        {clip.isPreview ? "Preview" : "Full"}
                      </span>
                    </td>

                    {/* Date */}
                    <td className="text-muted-foreground px-4 py-3 text-xs">
                      {new Date(clip.createdAt).toLocaleDateString()}
                    </td>

                    {/* Delete */}
                    <td className="px-4 py-3">
                      <button
                        onClick={() => handleDelete(clip.id, clip.s3Key)}
                        disabled={isPending}
                        title="Delete clip record"
                        className="text-muted-foreground hover:text-destructive rounded-md p-1.5 transition-colors disabled:opacity-50"
                      >
                        {isPending ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="size-3.5" />
                        )}
                      </button>
                    </td>
                  </tr>
                );
              })}
              {clips.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="text-muted-foreground py-12 text-center text-sm"
                  >
                    No clips found.
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
            onClick={() => router.push(`/admin/clips?page=${page - 1}`)}
            className="border-border bg-surface disabled:opacity-40 rounded-lg border px-4 py-2 text-sm font-medium"
          >
            Previous
          </button>
          <span className="text-muted-foreground text-sm">
            Page {page} / {totalPages}
          </span>
          <button
            disabled={page >= totalPages}
            onClick={() => router.push(`/admin/clips?page=${page + 1}`)}
            className="border-border bg-surface disabled:opacity-40 rounded-lg border px-4 py-2 text-sm font-medium"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
