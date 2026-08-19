# ClipCast 00: Overview

## What ClipCast does

A user uploads a long-form podcast video (or pastes a YouTube URL). ClipCast
transcribes it, has an LLM pick the clip-worthy moments, reframes each moment
to vertical 9:16 around whoever's talking, burns in captions, and hands back a
handful of short vertical clips, ready to post as Shorts/Reels/TikToks.

The user picks a **clip mode** before submitting, which changes what the LLM
looks for: **All** (every strong moment, the default), **Any** (open-ended — the
LLM invents its own category tags), **Q&A** (question + its answer),
**Educational**, **Motivational**, or **Highlights**. See
[13-clip-modes-and-ai.md](13-clip-modes-and-ai.md).

ClipCast also has an **Audio Studio** (docs/14–16, 19): generate an original
instrumental from a text prompt, or mash up two YouTube tracks (vocal over a new
AI-composed bed) — driven by the same multi-agent crew and rendered on Modal.

## The two halves

```
┌──────────────────────────┐        ┌──────────────────────────────────────┐
│  clipcast-frontend        │        │  clipcast-backend (Modal cloud)        │
│  (Next.js 16, Vercel/VPS) │        │                                        │
│                           │        │  downloader (CPU)  yt-dlp → S3         │
│  • Auth, billing, UI      │ HTTPS  │  processor  (L40S) transcribe · LLM    │
│  • Postgres (Prisma)      │ ─────▶ │              moment pick · crew ·      │
│  • Inngest queue          │        │              TalkNet · ffmpeg render   │
│  • Admin panel            │        │  mixer      (L40S) Audio Studio mixes  │
│  • Audio Studio           │        │  composer   (L4)   ACE-Step music gen  │
└──────────────────────────┘        └──────────────────────────────────────┘
            │                                   │
            ▼                                   ▼
        AWS S3 ◀── shared bucket: source uploads + rendered clips/audio ──▶
```

The LLM steps (moment picking, the production crew) run on whichever provider is
selected in the admin panel — **DeepSeek** (default), **Gemini**, or **Claude** —
and always fall back to deterministic logic if no provider is reachable.

**Local development never downloads or processes video.** The frontend and its
job queue (Inngest) run on your machine; every GPU/network-heavy step is a
Modal HTTPS call. This is a deliberate constraint, not an accident. See
[06-video-processing-pipeline.md](06-video-processing-pipeline.md).

## Why these services, specifically

| Concern | Choice | Why |
|---|---|---|
| App framework | Next.js (App Router) | Server actions and server components remove the need for a separate API layer for CRUD-shaped work |
| Auth | Auth.js (NextAuth v5) | Handles OAuth (Discord, Google) and credentials in one config; JWT sessions need no server-side session store |
| Database | Postgres via Supabase, Prisma ORM | Managed Postgres plus a typed query layer; Supabase's pooler gives a transaction-mode URL for runtime and a session-mode URL for migrations |
| Background jobs | Inngest | Durable step functions: a multi-minute Modal call can be polled step-by-step without a serverless function timing out, and steps replay safely on retry |
| GPU compute | Modal | Pay-per-second GPU containers with no idle server to manage; `@modal.enter()` keeps large models resident across warm requests |
| Object storage | AWS S3 | Shared handoff point between the frontend (uploads/presigned URLs) and Modal (reads sources, writes clips); neither side needs direct access to the other's filesystem |
| Transcription | WhisperX | Whisper accuracy plus forced word-level alignment, needed for accurate caption timing |
| Moment selection & AI crew | DeepSeek / Gemini / Claude | Swappable per job from the admin panel; all cheap and good at "find timestamps matching this rule" or "make one production decision as JSON". Missing/unreachable providers fall back to deterministic logic |
| Active-speaker detection | TalkNet | Lets vertical reframing follow whoever is talking instead of a static center-crop |
| Music generation | ACE-Step (3.5B) | Open-source text-to-music model that renders the instrumental bed for Audio Studio jobs (docs/14) |
| Agent observability | Langfuse (free OSS) | Optional trace dashboard for the crew's decisions; the built-in "Production Room" needs nothing extra (docs/18) |
| Payments | Stripe | Checkout Sessions for one-time credit-pack purchases; webhook credits the account |

## Repository layout

```
ClipCast/
├── .env                        single source of truth for both halves (gitignored)
├── .env.example                 template, copy to .env and fill in
├── start.sh                     local dev orchestration (frontend + Inngest + Stripe listener)
├── docs/                        you are here
│   └── excalidraw/               visual diagrams, one per major flow, see docs/excalidraw/README.md
├── clipcast-frontend/           Next.js app, see clipcast-frontend/README.md
└── clipcast-backend/            Modal apps, see clipcast-backend/README.md
    ├── apps/
    │   ├── downloader/           YouTube → S3 (CPU)
    │   ├── processor/            S3 → transcribe/pick/render → S3 (L40S GPU)
    │   ├── mixer/                Audio Studio: mashup + arrangement (L40S GPU)
    │   └── composer/             ACE-Step music generation (L4 GPU)
    └── crew/                     shared multi-agent framework (docs/17),
                                  vendored into apps/mixer + apps/processor
```

## Diagrams

- [`docs/excalidraw/`](excalidraw/): one informal architecture diagram per
  major flow (system design, pipeline overview, credits/billing, video
  processing, YouTube ingestion), each numbered to match the doc stages
  below. See [`docs/excalidraw/README.md`](excalidraw/README.md).
- [`docs/diagrams/`](diagrams/): the formal diagram set. Use case, system
  architecture, flowchart, activity, sequence, class, ER, and data flow
  (Level 0 and Level 1). See [`docs/diagrams/README.md`](diagrams/README.md).

## Reading order

1. [01-environment-and-accounts.md](01-environment-and-accounts.md): every external account you need before anything runs
2. [02-database-schema.md](02-database-schema.md): the data model
3. [03-authentication-and-roles.md](03-authentication-and-roles.md): login, sessions, admin gating
4. [04-frontend-app-structure.md](04-frontend-app-structure.md): how the Next.js app is organized
5. [05-uploads-and-queue.md](05-uploads-and-queue.md): upload → queue → Modal, step by step
6. [06-video-processing-pipeline.md](06-video-processing-pipeline.md): what happens inside Modal
7. [07-billing-and-credits.md](07-billing-and-credits.md): Stripe, credits, the purchase ledger
8. [08-admin-panel.md](08-admin-panel.md): admin panel and audit log
9. [09-deployment.md](09-deployment.md): deploying both halves for real

Deep dives (read after the tour above):

10. [10-realtime-data-and-state.md](10-realtime-data-and-state.md): TanStack Query layer — live dashboard data without whole-page re-renders
11. [11-notifications-and-email.md](11-notifications-and-email.md): SMTP/Resend transport, queued sends via Inngest, email OTP sign-in
12. [12-captions-and-branding.md](12-captions-and-branding.md): word-level caption pills, font-metric math, per-user color & watermark
13. [13-clip-modes-and-ai.md](13-clip-modes-and-ai.md): mode prompts, the All fan-out, open-ended Any mode, daily auto-clip cron
14. [14-audio-studio-mode.md](14-audio-studio-mode.md): **built + deployed** — AI music generation + YouTube mashup mixing (stem split, beat/key matching, harmonic mixing), the open-source tool stack, current state + known gaps
15. [15-mashup-mixing-mechanics.md](15-mashup-mixing-mechanics.md): the music mechanics in plain language: how two songs are joined (stem swap, beat/grid alignment, key matching, transitions, making a new beat), no music knowledge needed
16. [16-ai-arrangement-and-audio-rating.md](16-ai-arrangement-and-audio-rating.md): **built** — the LLM decides the DJ arrangement, an Audiobox-Aesthetics rating loop keeps the best take
17. [17-multi-agent-production-crew.md](17-multi-agent-production-crew.md): **built** — the shared crew framework driving both pipelines (director, composer, lyricist, colorist, critic…)
18. [18-agent-monitoring.md](18-agent-monitoring.md): the built-in Production Room + optional Langfuse traces, and why every heavy task runs on Modal
19. [19-song-research-agent.md](19-song-research-agent.md): **built** — the Song Research (A&R) step: identify the song, pull real lyrics, find its viral moment, then produce
