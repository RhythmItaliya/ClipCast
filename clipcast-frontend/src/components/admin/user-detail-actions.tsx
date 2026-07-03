"use client";

import { Ban, CheckCircle2, Loader2, Shield, ShieldOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { adjustUserCredits, setUserBanned, setUserRole } from "~/actions/admin";

export function UserDetailActions({
  userId,
  role,
  banned,
}: {
  userId: string;
  role: "USER" | "ADMIN";
  banned: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [creditDelta, setCreditDelta] = useState("");

  function handleAdjustCredits() {
    const delta = parseInt(creditDelta, 10);
    if (isNaN(delta) || delta === 0) {
      toast.error("Enter a non-zero number (e.g. +10 or -5).");
      return;
    }
    startTransition(async () => {
      const res = await adjustUserCredits(userId, delta);
      if (res.success) {
        toast.success(`Credits updated → ${res.newCredits}`);
        setCreditDelta("");
        router.refresh();
      } else {
        toast.error(res.error ?? "Failed to update credits.");
      }
    });
  }

  function handleBan(next: boolean) {
    startTransition(async () => {
      const res = await setUserBanned(userId, next);
      if (res.success) {
        toast.success(next ? "User banned." : "User unbanned.");
        router.refresh();
      } else {
        toast.error(res.error ?? "Action failed.");
      }
    });
  }

  function handleRoleChange(next: "USER" | "ADMIN") {
    startTransition(async () => {
      const res = await setUserRole(userId, next);
      if (res.success) {
        toast.success(`Role set to ${next}.`);
        router.refresh();
      } else {
        toast.error(res.error ?? "Action failed.");
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1.5">
        <input
          type="number"
          value={creditDelta}
          onChange={(e) => setCreditDelta(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdjustCredits()}
          placeholder="±10 credits"
          disabled={isPending}
          className="border-border bg-background w-28 rounded-md border px-2 py-1.5 text-xs focus:ring-brand focus:outline-none focus:ring-1"
        />
        <button
          onClick={handleAdjustCredits}
          disabled={isPending}
          className="bg-brand text-brand-foreground rounded-md px-3 py-1.5 text-xs font-medium hover:opacity-90 disabled:opacity-50"
        >
          Apply
        </button>
      </div>

      <button
        onClick={() => handleRoleChange(role === "ADMIN" ? "USER" : "ADMIN")}
        disabled={isPending}
        className="border-border bg-surface hover:bg-surface-2 flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50"
      >
        {isPending ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : role === "ADMIN" ? (
          <ShieldOff className="text-destructive size-3.5" />
        ) : (
          <Shield className="text-brand size-3.5" />
        )}
        {role === "ADMIN" ? "Demote to User" : "Promote to Admin"}
      </button>

      <button
        onClick={() => handleBan(!banned)}
        disabled={isPending}
        className="border-border bg-surface hover:bg-surface-2 flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50"
      >
        {isPending ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : banned ? (
          <CheckCircle2 className="text-brand size-3.5" />
        ) : (
          <Ban className="text-destructive size-3.5" />
        )}
        {banned ? "Unban user" : "Ban user"}
      </button>
    </div>
  );
}
