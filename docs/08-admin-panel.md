# ClipCast 08: Admin panel

> **Update (2026-07-18): job observability.** Each row in `/admin/jobs` now
> links to a **job-detail page** (`/admin/jobs/[id]`, action `getAdminJob`) that
> shows the full who/what/why/how of a job: user, type/mode/genre, the
> processing summary, the complete error context (friendly + internal) for
> debugging, and the **multi-agent Production Room** — every crew decision with
> which role made it, whether the **real model or the deterministic fallback**
> ran it (+ the model name), and any per-step failure. Same RBAC as the rest of
> admin. See docs/17 (the crew) and docs/18 (Langfuse trace dashboard).

Everything lives under `src/app/admin/`, guarded by
`src/app/admin/layout.tsx` (see [03-authentication-and-roles.md](03-authentication-and-roles.md)
for the two-layer RBAC: layout redirect + per-action `requireAdmin()`).
All reads/writes go through `src/actions/admin.ts`. Nav is one array in
`src/components/admin/shell.tsx` driving both the sidebar and the topbar.

## Sections

| Route | Purpose | Key files |
|---|---|---|
| `/admin` | Platform stats at a glance (users, clips, jobs, active/failed jobs, banned users, total revenue), quick links, **and the AI-provider control** — a live switch for which LLM drives the crew (DeepSeek / Gemini / Claude), applied to the next job with no redeploy | `app/admin/page.tsx`, `getAdminStats()`/`getAdminRevenueStats()`, `AiProviderSetting` + `getLlmProviderSetting()`/`setLlmProvider()` |
| `/admin/users` | Every account, search-free paginated table, inline credit adjust / role toggle / ban toggle | `components/admin/users-table.tsx`, `getAdminUsers()` |
| `/admin/users/[id]` | One user's full picture: profile, credits/role/ban controls, recent jobs, recent clips, purchase history, YouTube/Stripe connection status | `app/admin/users/[id]/page.tsx`, `getAdminUserDetail()` |
| `/admin/jobs` | Every `UploadedFile` across all users, filterable by status, "reset stuck job(s)" | `components/admin/jobs-table.tsx`, `getAdminJobs()` / `resetSingleJob()` / `resetAllStuckJobs()` |
| `/admin/clips` | Every rendered `Clip` across all users, delete the DB record (does not touch S3) | `components/admin/clips-table.tsx`, `getAdminClips()` / `deleteAdminClip()` |
| `/admin/billing` | Revenue stat cards + paginated `Purchase` ledger | `components/admin/billing-table.tsx`, `getAdminRevenueStats()` / `getAdminPurchases()` |
| `/admin/audit` | Every admin mutation, who did it, when | `components/admin/audit-log-table.tsx`, `getAdminAuditLog()` |

## The audit trail

`AdminAuditLog` (see [02-database-schema.md](02-database-schema.md)) is
written by a single helper, `logAdminAction()` in `src/actions/admin.ts`,
called from every mutating action: `adjustUserCredits` → `"credits.adjust"`,
`setUserBanned` → `"user.ban"`/`"user.unban"`, `setUserRole` →
`"user.promote"`/`"user.demote"`, `resetSingleJob`/`resetAllStuckJobs` →
`"job.reset"`/`"job.reset_all"`, `deleteAdminClip` → `"clip.delete"`,
`setLlmProvider` → `"set_llm_provider"`. Logging
is best-effort, wrapped in its own `.catch()` so a logging failure can never
fail the actual mutation the admin intended.

`requireAdmin()` returns `{ id, email }` specifically so these calls can
attribute the log entry without a second DB query per action.

## Loading states

Every admin route has a `loading.tsx` pairing one of three shared skeletons
(`src/components/skeletons/`): `AdminStatGridSkeleton` (Overview, Billing's
stat cards), `AdminTableSkeleton` (Users/Jobs/Clips/Billing/Audit, same
"title + paginated table" shape, parameterized by column count), and
`AdminUserDetailSkeleton` (the one bespoke layout, for `/admin/users/[id]`).

## How to build a new admin section from scratch

Every admin page follows the exact same recipe. Here's the whole thing end to
end, using the real `logAdminAction()` helper and `adjustUserCredits()` action
as the template:

**Step 1: the audit-log helper** (`src/actions/admin.ts`):

```ts
async function logAdminAction(
  admin: { id: string; email: string },
  action: string, targetType: string, targetId?: string, detail?: string,
) {
  await db.adminAuditLog
    .create({ data: { adminId: admin.id, adminEmail: admin.email, action, targetType, targetId, detail } })
    .catch((err) => console.warn("[admin audit] failed to log", err)); // never fail the real mutation
}
```

**Step 2: a mutating action**, gated + logged:

```ts
export async function adjustUserCredits(userId: string, delta: number) {
  const admin = await requireAdmin();
  if (!Number.isInteger(delta) || delta === 0) return { success: false, error: "Delta must be a non-zero integer." };

  const updated = await db.user.update({
    where: { id: userId }, data: { credits: { increment: delta } }, select: { credits: true, email: true },
  });
  await logAdminAction(admin, "credits.adjust", "user", userId, `${delta > 0 ? "+" : ""}${delta} credits → ${updated.email}`);
  revalidatePath("/admin/users");
  revalidatePath(`/admin/users/${userId}`);
  return { success: true, newCredits: updated.credits };
}
```

**Step 3: a read**, paginated, admin-gated:

```ts
export async function getAdminPurchases(page = 1, pageSize = 30) {
  await requireAdmin();
  const skip = (page - 1) * pageSize;
  const [purchases, total] = await Promise.all([
    db.purchase.findMany({
      skip, take: pageSize, orderBy: { createdAt: "desc" },
      select: { id: true, pack: true, credits: true, amountTotal: true, currency: true, createdAt: true,
                user: { select: { id: true, email: true, name: true } } },
    }),
    db.purchase.count(),
  ]);
  return { purchases, total, page, pageSize };
}
```

**Step 4: the page** (server component, `app/admin/billing/page.tsx`):

```tsx
export default async function AdminBillingPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const { page: pageParam } = await searchParams;
  const page = Math.max(1, parseInt(pageParam ?? "1", 10) || 1);
  const [stats, { purchases, total, pageSize }] = await Promise.all([
    getAdminRevenueStats(),
    getAdminPurchases(page, 30),
  ]);
  return (
    <div className="space-y-6">
      {/* stat cards from `stats` */}
      <BillingTable purchases={purchases} total={total} page={page} pageSize={pageSize} />
    </div>
  );
}
```

**Step 5: nav entry** (`src/components/admin/shell.tsx`, this one array
drives both the sidebar and the topbar title/description):

```ts
const nav = [
  // ...existing entries...
  { title: "Billing", to: "/admin/billing", icon: DollarSign, description: "Revenue and credit-pack purchases." },
] as const;
```

**Step 6: a matching `loading.tsx`** so the page never flashes blank while
its queries run:

```tsx
// app/admin/billing/loading.tsx
import { AdminStatGridSkeleton, AdminTableSkeleton } from "~/components/skeletons";
export default function Loading() {
  return (
    <div className="space-y-6">
      <AdminStatGridSkeleton count={3} showHeader={false} />
      <AdminTableSkeleton columns={5} rows={10} />
    </div>
  );
}
```

That's the entire recipe for adding any new admin page: a `select`-shaped
read, an optional gated+logged mutation, a server-component page, a nav entry,
and a paired skeleton.

## Next

[09-deployment.md](09-deployment.md): putting both halves somewhere real.

## Safety & consistency notes

Every destructive or high-impact action (ban/unban, promote/demote, delete
clip, reset all stuck jobs) goes through the shared themed confirm dialog
(`useConfirm`) — no native browser popups, no single-click bans. Admin
mutations write `AdminAuditLog` rows and `revalidatePath` only the admin
routes; the user detail page also shows the target user's full credit
ledger. Admin stays server-rendered (URL pagination + server actions) by
design — nothing polls here, so the dashboard's TanStack layer (doc 10)
is intentionally not used.
