# ClipCast frontend

The Next.js (T3 stack) web app for **ClipCast**.
It handles auth, credits/billing, video upload + YouTube submission, the
processing queue, and the admin panel. All heavy GPU/AI work runs on the Modal
backend (see [`../clipcast-backend`](../clipcast-backend)); this app never
processes video locally.

Runs on **http://localhost:3000** in dev (`npm run dev`).

## Stack

- **Next.js 16** (App Router, Turbopack) + React 19
- **Auth.js (NextAuth v5)** — Credentials (bcrypt), Discord OAuth, and Google
  OAuth (also reused for the YouTube channel-connect feature)
- **Prisma** → Supabase Postgres
- **Stripe** for credit-pack purchases
- **Inngest** for the background processing queue + the daily cron
- **AWS S3** for source uploads and rendered clips
- **Tailwind CSS** + shadcn/ui (Radix primitives)

## Key paths

```
src/
├── app/
│   ├── dashboard/             user app: overview/uploader, clips, queue, youtube, billing, settings
│   ├── admin/                 admin panel: overview, users, users/[id], jobs, clips, billing, audit
│   ├── login/, signup/        auth pages
│   └── api/
│       ├── auth/[...nextauth]/    NextAuth route handler
│       ├── youtube/callback/      Google OAuth callback for channel connect
│       ├── stripe/webhook/        Stripe credit-purchase webhook
│       ├── queue-status/          polls job + credit status (client polling)
│       ├── cancel-job/            cancel an in-flight Inngest run
│       └── reset-stuck-jobs/      manual retry for a stuck job
├── actions/                   server actions ("use server"), one file per domain
│   ├── auth.ts                 signUp, updateProfile, deleteAccount
│   ├── admin.ts                 all admin reads/mutations (requireAdmin-gated)
│   ├── generation.ts             processVideo, processYoutubeVideo, clearQueueItem
│   ├── clips.ts                  getClipUrl (presigned), deleteClip
│   ├── s3.ts                     presigned upload URL
│   ├── stripe.ts                 createCheckoutSession
│   └── youtube.ts                 YouTube OAuth + channel videos
├── inngest/
│   ├── client.ts                 Inngest client config
│   └── functions.ts              processVideoFn, dailyClipScheduler, syncInngestCancellation
├── server/
│   ├── auth/config.ts             NextAuth providers + callbacks (adds role/id to session)
│   ├── db.ts                       Prisma client singleton
│   └── usage.ts                    per-user usage limits (credits/day-cap/active-jobs)
├── lib/
│   ├── limits.ts                   LIMITS constants (single source of truth)
│   ├── errors.ts                   friendly error messages, fetchWithTimeout, offline detection
│   └── auth.ts                     bcrypt hash/compare
└── components/
    ├── dashboard/                  uploader, queue table, clips grid, settings, shell/nav
    ├── admin/                      users/jobs/clips/billing/audit tables, user-detail, shell/nav
    └── skeletons/                  one skeleton per route shape, paired with a loading.tsx
```

## Auth & roles

`User.role` is `USER` or `ADMIN` (Prisma enum, default `USER`). Every
`/admin/*` route's `layout.tsx` calls `auth()` and redirects non-admins to
`/dashboard` (not a 403 — regular users never learn `/admin` exists). Every
admin server action in `src/actions/admin.ts` independently calls a
`requireAdmin()` guard, so the check holds even if someone calls the action
directly. Banned users (`User.banned`) fail the Credentials provider's
`authorize()` outright.

## Clip modes

The dashboard's **Clip Mode** selector drives which moments the backend
extracts. The selected value flows: UI → `actions/generation.ts` → Inngest
event → Modal `clip_mode` → the matching prompt in `CLIP_MODE_PROMPTS`
(`clipcast-backend/apps/processor/main.py`). Modes: **All**, **Q&A**,
**Educational**, **Motivational**, **Highlights**.

## Credits & billing

1 credit = 1 minute of source video (rounded up, minimum 1 per job). Credits
are deducted in `inngest/functions.ts`'s `processVideoFn` after Modal returns
the exact duration. Credit packs are purchased via Stripe Checkout
(`actions/stripe.ts`); the webhook (`app/api/stripe/webhook/route.ts`) credits
the account and writes a `Purchase` ledger row (idempotent on
`stripeSessionId`, so Stripe's automatic webhook retries can't double-credit).

## Admin panel

`/admin` (Overview), `/admin/users` (+ `/admin/users/[id]` detail),
`/admin/jobs`, `/admin/clips`, `/admin/billing` (revenue + purchase ledger),
`/admin/audit` (every ban/promote/credit-adjust/job-reset/clip-delete, who did
it, and when — `AdminAuditLog`, written via `logAdminAction()` in
`actions/admin.ts`).

## Develop

```bash
npm install
npx prisma db push          # apply schema to Supabase
npm run dev                 # http://localhost:3000
npm run inngest-dev         # Inngest worker (separate terminal) — http://localhost:8288
```

Or from the repo root, `./start.sh` starts the frontend, the Inngest worker, and
the Stripe webhook listener together. Environment comes from the single
repo-root `.env` (loaded via `@next/env`, validated in `src/env.js`).

## Common scripts

| Command | What it does |
|---------|--------------|
| `npm run dev` | Next.js dev server (Turbopack) |
| `npm run build` | `prisma db push` then production build |
| `npm run check` | Lint + typecheck |
| `npm run db:studio` | Prisma Studio (DB GUI) |
| `npm run db:push` | Push schema to Postgres |
| `npm run db:migrate` | Deploy migrations (production) |

See [`../docs/`](../docs/) for a full staged walkthrough of how this app fits
together with the backend.
