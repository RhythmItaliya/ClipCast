# ClipCast — 04 — Frontend app structure

## Route groups

Three top-level areas under `src/app/`:

- **Public** — `/`, `/login`, `/signup` (redirects/auth forms only, no landing
  page — `/` just redirects based on session state).
- **`/dashboard/*`** — the regular user app: overview + uploader
  (`/dashboard`), `clips`, `queue`, `youtube` (channel connect), `billing`,
  `settings`. Wrapped by `src/app/dashboard/layout.tsx` (auth guard +
  `DashboardShell`).
- **`/admin/*`** — the admin panel (see [08-admin-panel.md](08-admin-panel.md)
  for the full breakdown). Wrapped by `src/app/admin/layout.tsx` (role guard +
  `AdminShell`).

Both shells (`src/components/dashboard/shell.tsx`,
`src/components/admin/shell.tsx`) read a `nav` array to drive both the sidebar
links *and* the topbar title/description for the current route — adding a page
means adding one nav entry, not touching the topbar separately.

## Server actions, not a separate API layer

Almost all reads/writes go through `"use server"` functions in `src/actions/`,
one file per domain (`admin.ts`, `auth.ts`, `clips.ts`, `generation.ts`, `s3.ts`,
`stripe.ts`, `youtube.ts`). Convention used throughout:

- Every action re-checks `auth()` itself — never trust that only an
  authorized UI path could have called it.
- Mutating actions return `{ success: boolean; error?: string }` (or a small
  extension of that shape) rather than throwing, so client components can show
  a friendly `toast.error(res.error)` instead of an unhandled-rejection
  boundary.
- Mutating actions call `revalidatePath()` on the affected route(s) instead of
  the caller manually refetching.

A few things stay as real HTTP routes under `src/app/api/` instead of server
actions, specifically where an external service needs to call in
(`stripe/webhook`, `youtube/callback`, `auth/[...nextauth]`) or where the
client polls on an interval (`queue-status`).

## Loading states

Every route that fetches data server-side has a matching `loading.tsx` next to
its `page.tsx` — this is Next's file convention for wrapping the page in a
`<Suspense>` boundary automatically, no manual `<Suspense>` needed. Each
`loading.tsx` renders one component from `src/components/skeletons/`, matched
to that page's actual layout (e.g. `QueueSkeleton` mirrors the queue table's
columns, `AdminUserDetailSkeleton` mirrors the user-detail page's card + two
lists). When adding a new data-fetching page, add its skeleton and
`loading.tsx` in the same change — don't ship a page that flashes blank while
its query runs.

## Styling

Tailwind CSS v4 with design tokens in `src/styles/globals.css`
(`--brand`, `--surface`, `--surface-2`, `--brand-soft`, etc.) — components use
`bg-surface/60 border-border rounded-3xl` card conventions, pill buttons
(`bg-brand text-brand-foreground rounded-full`), and small uppercase badges
(`rounded-full text-[10px] font-bold uppercase ring-1`) consistently. Space
Grotesk for headings, DM Sans for body (loaded as CSS variables in
`src/app/layout.tsx`). UI primitives in `src/components/ui/` are shadcn/ui
(Radix underneath). `lucide-react` no longer ships a YouTube icon — use
`YoutubeIcon` from `src/components/brand.tsx`.

There's a separate `ClipCast_by_me/` directory at the repo root — a
Lovable-generated design reference the live UI was ported from. It's kept
as a design reference only; don't edit or delete it, and match its visual
language for new work.

## How to build a new page, start to finish

This is the actual recipe every existing page follows — use it verbatim for a
new one.

**Step 1 — the server action** (`src/actions/<domain>.ts`):

```ts
"use server";
import { revalidatePath } from "next/cache";
import { auth } from "~/server/auth";
import { db } from "~/server/db";

type ActionResult = { success: boolean; error?: string };

export async function deleteClip(clipId: string): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: "Your session has expired. Please log in again." };

  const clip = await db.clip.findUnique({ where: { id: clipId, userId: session.user.id }, select: { id: true } });
  if (!clip) return { success: false, error: "Clip not found." };

  await db.clip.delete({ where: { id: clip.id } });
  revalidatePath("/dashboard/clips");
  return { success: true };
}
```

Note the `where: { id: clipId, userId: session.user.id }` — scoping the query
to the caller's own `userId` is the actual ownership check; there's no
separate "is this my clip?" branch to forget.

**Step 2 — the page** (`src/app/dashboard/clips/page.tsx`, a Server
Component — fetch data directly, no client-side loading state needed):

```tsx
export default async function ClipsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const clips = await db.clip.findMany({ where: { userId: session.user.id }, orderBy: { createdAt: "desc" } });
  return <ClipsGrid clips={clips} />;
}
```

**Step 3 — the client component** that calls the action and shows feedback:

```tsx
"use client";
import { toast } from "sonner";
import { deleteClip } from "~/actions/clips";

function handleDelete(clipId: string) {
  startTransition(async () => {
    const res = await deleteClip(clipId);
    if (res.success) toast.success("Clip deleted.");
    else toast.error(res.error ?? "Failed to delete.");
  });
}
```

**Step 4 — the skeleton + `loading.tsx` pair**, added in the same change:

```tsx
// src/components/skeletons/clips-grid-skeleton.tsx
export function ClipsGridSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="aspect-[9/16] rounded-2xl" />)}
    </div>
  );
}
```
```tsx
// src/app/dashboard/clips/loading.tsx
import { ClipsGridSkeleton } from "~/components/skeletons";
export default function Loading() { return <ClipsGridSkeleton />; }
```

**Step 5 — nav entry**, if the page needs to be reachable from the sidebar
(`src/components/dashboard/shell.tsx`'s `nav` array — same pattern as the
admin shell in [08-admin-panel.md](08-admin-panel.md)).

That's the whole loop: action (auth-checked, ownership-scoped, revalidating)
→ server component page (fetches directly) → client component (calls the
action, shows toast feedback) → skeleton + `loading.tsx` → nav entry.

## Next

[05-uploads-and-queue.md](05-uploads-and-queue.md) — the core user flow: get a
video from the browser into the processing pipeline.
