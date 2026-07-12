# ClipCast 10: Realtime data & client state (TanStack Query)

How the dashboard stays live without re-rendering the whole page.

## The one shared query

Everything live on the dashboard (sidebar credit card, topbar credits pill,
hero stats, uploader gates, queue table) reads a single TanStack Query:

- Key: `QUEUE_STATUS_KEY = ["queue-status"]` — defined in
  `src/lib/queue-status.ts`, a plain module with **no** `"use client"`
  directive so both the server layout and the client hook can import it at
  runtime (a value imported from a client module into a server component
  becomes a client-reference proxy and throws at request time).
- Data: `QueueStatusData` (`~/types`) — `{ uploadedFiles, credits,
  uploadsToday, activeJobs }`, exactly the JSON `/api/queue-status` returns
  (dates as ISO strings).
- Hook: `useQueueStatus(select)` in `src/hooks/use-queue-status.ts`. Every
  consumer passes a `select` for just the slice it renders.

## Server seeding (no loading flash)

`src/app/dashboard/layout.tsx` fetches usage + queue once per request
(`getUsageStats`, `getQueueFiles`), builds a `QueryClient`, calls
`setQueryData(QUEUE_STATUS_KEY, ...)` and wraps the shell in
`<QueryProvider><HydrationBoundary state={dehydrate(qc)}>`. First paint has
live data; no page re-fetches it on mount.

## Why nothing over-renders

1. **Structural sharing** (TanStack default): a refetch returning identical
   data keeps identical object references — zero subscribers re-render.
   Changed data preserves identity for the unchanged parts, so one job's
   status change re-renders only that queue row (`QueueRow` is `memo`'d with
   `useCallback` handlers).
2. **Tracked selects**: `useQueueStatus((d) => d.credits)` re-renders only
   when credits changes; queue updates don't touch credit displays and vice
   versa. The shell itself subscribes to nothing — its two credit displays
   are tiny self-subscribing leaf components (`CreditBalanceCard`,
   `TopbarCreditsPill`).
3. **No `revalidatePath("/dashboard")` after job mutations**: submitting,
   clearing, retrying or cancelling a job calls `useRefreshQueueStatus()`
   (a targeted `refetchQueries`) instead of forcing a full RSC re-render.
   (Admin actions still use `revalidatePath` deliberately — server-rendered
   tables, low-frequency mutations, nothing polls there.)

## Polling policy

`refetchInterval` is a function of the data: 10s while a queued/processing
job is <2 min old (download phase feedback), 30s for long-running GPU jobs,
20s idle heartbeat. `refetchIntervalInBackground` stays false so hidden tabs
stop polling. `staleTime: 5s` stops page navigations from double-fetching
what the interval just fetched.

## Rules for new features

- New live data → new query key + hook in `src/hooks/`, seed it in the layout
  only if it must be on first paint.
- Never put a query key or shared runtime constant inside a `"use client"`
  file — plain module in `src/lib/` instead.
- After a mutation, refetch the affected query; reach for `revalidatePath`
  only for server-rendered pages with no client cache.
