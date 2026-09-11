# CLAUDE.md — ClipCast

Orientation for Claude Code. Keep this short and high-signal; deep detail lives
in `docs/` and the per-folder READMEs. Update it when the shape of the project
changes, not for routine edits.

## What this is

ClipCast is an AI podcast clipper: paste a YouTube link (or upload a video) and
get back short 9:16 clips — auto-transcribed, LLM-selected + viral-ranked,
captioned, and reframed with active-speaker tracking. It also has an **Audio
Studio** that generates original instrumentals from a prompt or mashes up two
YouTube tracks, driven by a multi-agent AI production crew.

> Note: this is the project the user may refer to by other names in passing
> (e.g. "graphify"). There is no separate repo — all work happens here.

## Layout (two halves)

- **`clipcast-frontend/`** — Next.js 16 (T3 stack, App Router, Turbopack) +
  React 19. Auth, credits/billing, uploads, Audio Studio, the processing queue,
  the Production Room (AI-crew decision trail), and the admin panel. **Never
  processes video/audio locally** — all heavy work goes to the Modal backend.
  Runs on http://localhost:3000. See `clipcast-frontend/README.md`.
- **`clipcast-backend/`** — four independently deployed Modal apps + a shared
  `crew/` multi-agent framework. See `clipcast-backend/README.md`.
  - `apps/downloader/` (CPU) — YouTube URL → download via rotating free/residential proxies → upload source to S3.
  - `apps/processor/` (L40S GPU, app name `clipcast`) — transcribe · pick moments (LLM) · reframe 9:16 (ASD) · burn captions · upload clips.
  - `apps/mixer/` (L40S GPU) — Audio Studio: Song Research → music crew → stem/beat/key mix → Audiobox-scored redo loop.
  - `apps/composer/` (L4 GPU) — ACE-Step (3.5B) text-to-music; called by the mixer by name, so **deploy it first**.

## Stack

Auth.js (NextAuth v5: Credentials/bcrypt, Discord + Google OAuth) · Prisma →
Supabase Postgres · Stripe (credit packs) · Inngest (background queue + crons) ·
AWS S3 (sources + rendered clips) · Tailwind + shadcn/ui. Backend LLM work runs
on DeepSeek (default) / Gemini / Claude — switchable in the admin panel.

## Job flow

Clip: UI → `actions/generation.ts` → Inngest event → `clipcast-downloader`
(→ S3) → `clipcast` processor (→ S3 clips). Credits deducted in
`inngest/functions.ts` after Modal returns the real duration. Client polls
`api/queue-status`. Audio jobs run the same way through `clipcast-mixer`
(+ `clipcast-composer`).

## Running it

```bash
# frontend deps
cd clipcast-frontend && npm install && cd ..

# everything local (frontend + Inngest worker + Stripe webhook listener)
./start.sh
# ...or individually, from clipcast-frontend/:
npm run dev            # Next.js  (http://localhost:3000)
npm run inngest-dev    # Inngest worker (http://localhost:8288)
npm run check          # eslint + tsc --noEmit  <-- run before calling work done
npm run db:push        # apply Prisma schema to Supabase
```

- **Single env file:** the repo-root `.env` (not per-folder). Keys documented in
  `.env.example` and `docs/01-environment-and-accounts.md`. Loaded via
  `@next/env`, validated in `clipcast-frontend/src/env.js`.
- **Backend deploy:** `./clipcast-backend/deploy.sh all` (composer first).
  Push secrets with `clipcast-backend/scripts/setup_modal_secret.py`.
- **E2E test:** `python clipcast-backend/scripts/test_pipeline.py --preview`
  (real Modal endpoints; `--preview` skips ASD + subtitles, ~5–10 min).

## Conventions & gotchas (persistent memory — follow these)

- **Shared types** live in `clipcast-frontend/src/types` (`~/types` barrel).
  Never import runtime values from `"use client"` modules into server components.
- **Prisma:** `tsc` does NOT catch unknown/missing `select` fields — verify
  changed queries against a live DB, don't trust the typecheck alone.
- **Clean as you go:** on every change, sweep the files you touch for dead
  code / unused exports and consider test coverage — proactively, not only when
  asked.
- **UI design language:** the frontend was ported from a Lovable mock; `src/` is
  the source of truth. Match the existing dashboard design system.
- **Testing:** exercise features via the seeded test user through the real
  pipeline (no bespoke Modal harnesses). 2-job active-concurrency limit.
- Richer, evolving versions of these live in the auto-memory index
  (`MEMORY.md`) and are loaded each session.

## Docs map

`docs/00-overview.md` is the front door. Notable: `02` schema, `03` auth/roles,
`06` video pipeline, `07` billing/credits, `13` clip modes + AI, `14–16` Audio
Studio / mixing / rating, `17` multi-agent crew, `18` agent monitoring,
`19` song research. Diagrams (excalidraw) under `docs/diagrams/`. Academic
submission material is in `ClipCast_Docs/` (not code).

## Known rough edges

Recent commits carry **TEMP** scaffolding — a local `yt-dlp` fallback in the
download poll loop and dev endpoint, plus a YouTube bot-detection bypass (iOS
player client + cookie auth) in the downloader. Treat these as fragile: prefer
the proxy path (`YT_DLP_PROXY`) and remove the TEMP fallbacks once the real path
is stable. `AUDIO_STUDIO_SUMMARY.txt` and `MUSIC_QUALITY_PROBLEMS.txt` at the
root track open audio-quality issues.
