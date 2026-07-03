# ClipCast frontend

The Next.js (T3 stack) web app for **ClipCast**.
It handles auth, credits/billing, video upload + YouTube submission, and queues
processing jobs. All heavy GPU/AI work runs on the Modal backend (see
[`../clipcast-backend`](../clipcast-backend)); this app never processes video
locally.

## Stack

- **Next.js 16** (App Router, Turbopack) + React 19
- **Auth.js (NextAuth v5)** with Discord OAuth
- **Prisma** → Supabase Postgres
- **Stripe** for credit purchases
- **Inngest** for the background processing queue
- **Tailwind CSS** + shadcn/ui

## Key paths

```
src/
├── app/
│   ├── dashboard/            main app UI (upload / YouTube / queue)
│   └── api/
│       ├── queue-status/     polls job + credit status
│       └── stripe/webhook/   Stripe credit-purchase webhook
├── actions/generation.ts     server actions: processVideo / processYoutubeVideo
├── inngest/functions.ts       queue worker: calls Modal, deducts credits
├── components/dashboard-client.tsx   dashboard incl. Clip Mode selector
└── server/                    auth + db (Prisma) setup
```

## Clip modes

The dashboard's **Clip Mode** selector drives which moments the backend extracts.
The selected value flows: UI → `actions/generation.ts` → Inngest event →
Modal `clip_mode` → the matching prompt in `CLIP_MODE_PROMPTS`
(`clipcast-backend/apps/processor/main.py`). Modes: **All**, **Q&A**, **Educational**,
**Motivational**, **Highlights**.

## Credits

1 credit = 1 minute of source video (rounded up, minimum 1 per job). Credits are
deducted in `inngest/functions.ts` after Modal returns the exact duration.

## Develop

```bash
npm install
npx prisma db push          # apply schema to Supabase
npm run dev                 # http://localhost:3000
npm run inngest-dev         # Inngest worker (separate terminal)
```

Or from the repo root, `./start.sh` starts the frontend, the Inngest worker, and
the Stripe webhook listener together. Environment comes from the single repo-root
`.env` (loaded via `@next/env`).

## Common scripts

| Command | What it does |
|---------|--------------|
| `npm run dev` | Next.js dev server (Turbopack) |
| `npm run build` | Production build |
| `npm run check` | Lint + typecheck |
| `npm run db:studio` | Prisma Studio (DB GUI) |
| `npm run db:push` | Push schema to Postgres |
