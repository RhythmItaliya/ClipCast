# `crew` — the multi-agent production framework

Dependency-free orchestration for ClipCast's AI production crews (design:
[`docs/17`](../../docs/17-multi-agent-production-crew.md)).

A `Crew` runs a `flow` of role-specialised `Agent`s over a shared
`ProductionState`, records every decision + handoff to a `ProductionLog` (the
observable transcript), renders a take via a caller-supplied `execute`, and lets
a **critic** loop back to any role for a bounded number of rounds.

- **Fallback-first** — every `Agent` degrades to a deterministic function when
  its `LLM` is unavailable, so a crew always runs headless.
- **Model-agnostic** — agents talk to the `LLM` protocol; Gemini (or any other
  service, in any language) is a swappable adapter.
- **Pure stdlib** — unit-tested on CPU with a scripted mock LLM.

```bash
cd clipcast-backend/crew && python test_crew.py   # 5 CPU tests, no network
```

## Status
- **Phase 1 (this package): built + tested.** Framework only — no behaviour
  change to the pipelines yet.
- Phase 2 vendors it into `apps/mixer` (music crew) and Phase 3 into
  `apps/processor` (clip crew, incl. the dynamic **Colorist**). Phase 4 persists
  + streams the log to the "Production Room" UI. See `docs/17` §10.
