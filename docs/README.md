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
- [14-audio-studio-mode.md](14-audio-studio-mode.md) — **plan only**: AI music
  generation + YouTube×YouTube beat-matched mashups (Demucs stems, tempo/key
  matching, Camelot harmonic mixing, Gemini arrangement), the open-source
  stack, and how it slots into the existing Modal/Inngest architecture.
- [15-mashup-mixing-mechanics.md](15-mashup-mixing-mechanics.md) —
  plain-language: *how we actually join two songs* — stem swapping,
  beat/grid/phrase alignment, harmonic (Camelot) key matching, transitions
  (crossfade, bass swap), making a new beat, and the pro-vs-amateur
  guardrails. No music knowledge needed.
- [16-ai-arrangement-and-audio-rating.md](16-ai-arrangement-and-audio-rating.md)
  — the AI-driven half (**built** in `apps/mixer`): Gemini decides the DJ
  arrangement (which vocal part lands where, ducking, intro build), then an
  Audiobox-Aesthetics rating loop re-renders and keeps the best-scoring take.
  One warm Modal container; deterministic DSP is unit-tested.
- [17-multi-agent-production-crew.md](17-multi-agent-production-crew.md) —
  **plan only**: turn both pipelines into a film-production-style *crew of AI
  agents* (director, composer, lyricist, colorist, critic…) that understand the
  material emotionally, hand work to each other, revise in a bounded Modal loop,
  and leave a visible decision trail (the "Production Room" observability view).
  Everything dynamic — no hardcoded colors/moods — with mock-LLM CPU tests.

## Diagrams
- [diagrams/](diagrams/README.md) — the formal set (use case, architecture,
  flowchart, activity, sequence, class, ER, DFD 0/1), regenerable via
  `generate_diagrams.py`.
- [excalidraw/](excalidraw/README.md) — informal per-flow sketches from
  earlier iterations.
