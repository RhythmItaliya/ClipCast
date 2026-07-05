"use client";

import {
  Ban,
  CheckCircle2,
  CreditCard,
  Eye,
  Loader2,
  Shield,
  ShieldOff,
  User,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  adjustUserCredits,
  setUserBanned,
  setUserRole,
} from "~/actions/admin";
import { useConfirm } from "~/components/ui/confirm-dialog";

type AdminUser = {
  id: string;
  name: string | null;
  email: string;
  role: "USER" | "ADMIN";
  banned: boolean;
  credits: number;
  createdAt: Date;
  _count: { clips: number; uploadedFiles: number };
};

export function UsersTable({
  users,
  total,
  page,
  pageSize,
}: {
  users: AdminUser[];
  total: number;
  page: number;
  pageSize: number;
}) {
  const router = useRouter();
  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="space-y-4">
      {/* Summary */}
      <p className="text-muted-foreground text-sm">
        {total.toLocaleString()} total users — page {page} of {totalPages}
      </p>

      {/* Table */}
      <div className="border-border overflow-hidden rounded-2xl border">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 border-border border-b">
              <tr>
                {["User", "Role", "Credits", "Jobs", "Clips", "Joined", "Actions"].map(
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
              {users.map((u) => (
                <UserRow key={u.id} user={u} />
              ))}
              {users.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="text-muted-foreground py-12 text-center text-sm"
                  >
                    No users found.
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
              router.push(`/admin/users?page=${page - 1}`)
            }
            className="border-border bg-surface disabled:opacity-40 rounded-lg border px-4 py-2 text-sm font-medium transition-opacity hover:opacity-80"
          >
            Previous
          </button>
          <span className="text-muted-foreground text-sm">
            Page {page} / {totalPages}
          </span>
          <button
            disabled={page >= totalPages}
            onClick={() =>
              router.push(`/admin/users?page=${page + 1}`)
            }
            className="border-border bg-surface disabled:opacity-40 rounded-lg border px-4 py-2 text-sm font-medium transition-opacity hover:opacity-80"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

// ── Single row with inline actions ───────────────────────────────────────────

function UserRow({ user }: { user: AdminUser }) {
  const confirmDialog = useConfirm();
  const [isPending, startTransition] = useTransition();
  const [creditDelta, setCreditDelta] = useState("");
  const [showCreditInput, setShowCreditInput] = useState(false);

  const displayName = user.name ?? user.email.split("@")[0] ?? user.email;

  // Adjust credits
  function handleAdjustCredits() {
    const delta = parseInt(creditDelta, 10);
    if (isNaN(delta) || delta === 0) {
      toast.error("Enter a non-zero number (e.g. +10 or -5).");
      return;
    }
    startTransition(async () => {
      const res = await adjustUserCredits(user.id, delta);
      if (res.success) {
        toast.success(`Credits updated → ${res.newCredits}`);
        setCreditDelta("");
        setShowCreditInput(false);
      } else {
        toast.error(res.error ?? "Failed to update credits.");
      }
    });
  }

  // Ban / unban
  async function handleBan(banned: boolean) {
    const ok = await confirmDialog({
      title: banned ? `Ban ${user.email}?` : `Unban ${user.email}?`,
      description: banned
        ? "They will be signed out and unable to log in until unbanned."
        : "They will be able to sign in again.",
      confirmLabel: banned ? "Ban user" : "Unban user",
      destructive: banned,
    });
    if (!ok) return;
    startTransition(async () => {
      const res = await setUserBanned(user.id, banned);
      if (res.success) {
        toast.success(banned ? "User banned." : "User unbanned.");
      } else {
        toast.error(res.error ?? "Action failed.");
      }
    });
  }

  // Role change
  async function handleRoleChange(role: "USER" | "ADMIN") {
    const ok = await confirmDialog({
      title:
        role === "ADMIN"
          ? `Promote ${user.email} to admin?`
          : `Demote ${user.email} to regular user?`,
      description:
        role === "ADMIN"
          ? "They will get full access to the admin panel and every user's data."
          : "They will lose all admin panel access.",
      confirmLabel: role === "ADMIN" ? "Promote" : "Demote",
      destructive: role !== "ADMIN",
    });
    if (!ok) return;
    startTransition(async () => {
      const res = await setUserRole(user.id, role);
      if (res.success) {
        toast.success(`Role set to ${role}.`);
      } else {
        toast.error(res.error ?? "Action failed.");
      }
    });
  }

  return (
    <tr className={`transition-colors hover:bg-surface/50 ${user.banned ? "opacity-50" : ""}`}>
      {/* User */}
      <td className="px-4 py-3">
        <Link
          href={`/admin/users/${user.id}`}
          className="group flex items-center gap-2.5"
        >
          <div className="bg-brand-soft text-brand grid size-8 shrink-0 place-items-center rounded-full text-xs font-semibold uppercase">
            {displayName.charAt(0)}
          </div>
          <div className="min-w-0">
            <div className="truncate font-medium group-hover:underline">
              {displayName}
            </div>
            <div className="text-muted-foreground truncate text-xs">{user.email}</div>
          </div>
        </Link>
      </td>

      {/* Role badge */}
      <td className="px-4 py-3">
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
            user.role === "ADMIN"
              ? "bg-brand-soft text-brand"
              : "bg-muted text-muted-foreground"
          }`}
        >
          {user.role === "ADMIN" ? (
            <Shield className="size-2.5" />
          ) : (
            <User className="size-2.5" />
          )}
          {user.role}
        </span>
      </td>

      {/* Credits */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-1.5">
          <CreditCard className="text-muted-foreground size-3.5" />
          <span className="font-medium">{user.credits}</span>
        </div>
      </td>

      {/* Jobs */}
      <td className="px-4 py-3 text-sm">{user._count.uploadedFiles}</td>

      {/* Clips */}
      <td className="px-4 py-3 text-sm">{user._count.clips}</td>

      {/* Joined */}
      <td className="text-muted-foreground px-4 py-3 text-xs">
        {new Date(user.createdAt).toLocaleDateString()}
      </td>

      {/* Actions */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          {isPending ? (
            <Loader2 className="text-muted-foreground size-4 animate-spin" />
          ) : (
            <>
              {/* View detail */}
              <Link
                href={`/admin/users/${user.id}`}
                title="View user detail"
                className="border-border bg-surface hover:bg-surface-2 rounded-md border p-1.5 transition-colors"
              >
                <Eye className="size-3.5" />
              </Link>

              {/* Credit adjust */}
              {showCreditInput ? (
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    value={creditDelta}
                    onChange={(e) => setCreditDelta(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleAdjustCredits()}
                    placeholder="±10"
                    className="border-border bg-background w-16 rounded-md border px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-brand"
                    autoFocus
                  />
                  <button
                    onClick={handleAdjustCredits}
                    className="bg-brand text-brand-foreground rounded-md px-2 py-1 text-xs font-medium hover:opacity-90"
                  >
                    Apply
                  </button>
                  <button
                    onClick={() => {
                      setShowCreditInput(false);
                      setCreditDelta("");
                    }}
                    className="text-muted-foreground hover:text-foreground text-xs"
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setShowCreditInput(true)}
                  title="Adjust credits"
                  className="border-border bg-surface hover:bg-surface-2 rounded-md border p-1.5 transition-colors"
                >
                  <CreditCard className="size-3.5" />
                </button>
              )}

              {/* Role toggle */}
              <button
                onClick={() =>
                  handleRoleChange(user.role === "ADMIN" ? "USER" : "ADMIN")
                }
                title={user.role === "ADMIN" ? "Demote to User" : "Promote to Admin"}
                className="border-border bg-surface hover:bg-surface-2 rounded-md border p-1.5 transition-colors"
              >
                {user.role === "ADMIN" ? (
                  <ShieldOff className="text-destructive size-3.5" />
                ) : (
                  <Shield className="text-brand size-3.5" />
                )}
              </button>

              {/* Ban / unban */}
              <button
                onClick={() => handleBan(!user.banned)}
                title={user.banned ? "Unban user" : "Ban user"}
                className="border-border bg-surface hover:bg-surface-2 rounded-md border p-1.5 transition-colors"
              >
                {user.banned ? (
                  <CheckCircle2 className="text-brand size-3.5" />
                ) : (
                  <Ban className="text-destructive size-3.5" />
                )}
              </button>
            </>
          )}
        </div>
      </td>
    </tr>
  );
}
