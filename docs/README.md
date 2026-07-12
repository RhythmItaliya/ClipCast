# ClipCast documentation

Three depths, pick what you need:

## Short (5 minutes)
- [00-overview.md](00-overview.md) — what ClipCast does, the two halves
  (Next.js app + Modal GPU/CPU backends), why each service was chosen, repo
  layout.

## Long (the guided tour, 01-09)
Numbered to read in order: environment (01), database (02), auth (03),
frontend structure (04), uploads & queue (05), the Modal pipeline (06),
billing & credits (07), admin panel (08), deployment (09). Each ends with a
"later additions" section covering the newest behavior.

## Full (deep dives, 10-13)
- [10-realtime-data-and-state.md](10-realtime-data-and-state.md) — TanStack
  Query architecture: one shared query, structural sharing, selector
  subscriptions, polling policy, why nothing over-renders.
- [11-notifications-and-email.md](11-notifications-and-email.md) — mail
  transport chain (SMTP → Resend → console), Inngest-queued sends, every
  email + its trigger, email OTP sign-in.
- [12-captions-and-branding.md](12-captions-and-branding.md) — the caption
  renderer: OS/2 win-metric font math, per-word pill events, flicker-free
  layering, the Modal render-test harness, per-user color & watermark.
- [13-clip-modes-and-ai.md](13-clip-modes-and-ai.md) — Gemini prompts per
  mode, the All fan-out + dedupe, the open-ended Any mode with AI-invented
  category tags, HF fallback, daily auto-clip cron.

## Diagrams
- [diagrams/](diagrams/README.md) — the formal set (use case, architecture,
  flowchart, activity, sequence, class, ER, DFD 0/1), regenerable via
  `generate_diagrams.py`.
- [excalidraw/](excalidraw/README.md) — informal per-flow sketches from
  earlier iterations.
