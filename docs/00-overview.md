# ClipCast — 00 — Overview

## What ClipCast does

A user uploads a long-form podcast video (or pastes a YouTube URL). ClipCast
transcribes it, has an LLM pick the clip-worthy moments, reframes each moment
to vertical 9:16 around whoever's talking, burns in captions, and hands back a
handful of short vertical clips — ready to post as Shorts/Reels/TikToks.

The user picks a **clip mode** before submitting, which changes what the LLM
looks for: **Q&A** (question + its answer), **Educational**, **Motivational**,
**Highlights**, or **All**.

## The two halves

```
┌──────────────────────────┐        ┌──────────────────────────┐
│  clipcast-frontend        │        │  clipcast-backend         │
│  (Next.js 16, Vercel/VPS) │        │  (Modal — GPU cloud)       │
│                           │        │                           │
│  • Auth, billing, UI      │ HTTPS  │  • yt-dlp download        │
│  • Postgres (Prisma)      │ ─────▶ │  • WhisperX transcribe    │
│  • Inngest queue          │        │  • Gemini moment picker   │
│  • Admin panel            │        │  • TalkNet + ffmpeg render│
└──────────────────────────┘        └──────────────────────────┘
            │                                   │
            ▼                                   ▼
        AWS S3 ◀─── shared bucket: source uploads + rendered clips ──▶
```

**Local development never downloads or processes video.** The frontend and its
job queue (Inngest) run on your machine; every GPU/network-heavy step is a
Modal HTTPS call. This is a deliberate constraint, not an accident — see
[06-video-processing-pipeline.md](06-video-processing-pipeline.md).

## Why these services, specifically

| Concern | Choice | Why |
|---|---|---|
| App framework | Next.js (App Router) | Server actions + server components remove the need for a separate API layer for CRUD-shaped work |
| Auth | Auth.js (NextAuth v5) | Handles OAuth (Discord, Google) and credentials in one config; JWT sessions need no server-side session store |
| Database | Postgres via Supabase, Prisma ORM | Managed Postgres + a typed query layer; Supabase's pooler gives a transaction-mode URL for runtime and a session-mode URL for migrations |
| Background jobs | Inngest | Durable step functions — a multi-minute Modal call can be polled step-by-step without a serverless function timing out, and steps replay safely on retry |
| GPU compute | Modal | Pay-per-second GPU containers with no idle server to manage; `@modal.enter()` keeps large models resident across warm requests |
| Object storage | AWS S3 | Shared handoff point between the frontend (uploads/presigned URLs) and Modal (reads sources, writes clips) — neither side needs direct access to the other's filesystem |
| Transcription | WhisperX | Whisper accuracy plus forced word-level alignment, needed for accurate caption timing |
| Moment selection | Gemini 2.5 Flash | Cheap, fast, good enough at "find timestamps matching this rule" when constrained to exact transcript boundaries |
| Active-speaker detection | TalkNet | Lets vertical reframing follow whoever is talking instead of a static center-crop |
| Payments | Stripe | Checkout Sessions for one-time credit-pack purchases; webhook credits the account |

## Repository layout

```
ClipCast/
├── .env                        single source of truth for both halves (gitignored)
├── .env.example                 template — copy to .env and fill in
├── start.sh                     local dev orchestration (frontend + Inngest + Stripe listener)
├── docs/                        you are here
│   └── excalidraw/               visual diagrams — one per major flow, see docs/excalidraw/README.md
├── clipcast-frontend/           Next.js app — see clipcast-frontend/README.md
└── clipcast-backend/            Modal apps — see clipcast-backend/README.md
    └── apps/
        ├── downloader/           YouTube → S3
        └── processor/            S3 → transcribe/pick/render → S3
```

## Diagrams

- [`docs/excalidraw/`](excalidraw/) — one informal architecture diagram per
  major flow (system design, pipeline overview, credits/billing, video
  processing, YouTube ingestion), each numbered to match the doc stages
  below. See [`docs/excalidraw/README.md`](excalidraw/README.md).
- [`docs/diagrams/`](diagrams/) — the formal diagram set: use case, system
  architecture, flowchart, activity, sequence, class, ER, and data flow
  (Level 0 + Level 1). See [`docs/diagrams/README.md`](diagrams/README.md).

## Reading order

1. [01-environment-and-accounts.md](01-environment-and-accounts.md) — every external account you need before anything runs
2. [02-database-schema.md](02-database-schema.md) — the data model
3. [03-authentication-and-roles.md](03-authentication-and-roles.md) — login, sessions, admin gating
4. [04-frontend-app-structure.md](04-frontend-app-structure.md) — how the Next.js app is organized
5. [05-uploads-and-queue.md](05-uploads-and-queue.md) — upload → queue → Modal, step by step
6. [06-video-processing-pipeline.md](06-video-processing-pipeline.md) — what happens inside Modal
7. [07-billing-and-credits.md](07-billing-and-credits.md) — Stripe, credits, the purchase ledger
8. [08-admin-panel.md](08-admin-panel.md) — admin panel + audit log
9. [09-deployment.md](09-deployment.md) — deploying both halves for real
