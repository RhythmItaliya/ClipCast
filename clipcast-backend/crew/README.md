# `crew` — the multi-agent production framework

Dependency-free orchestration for ClipCast's AI production crews (design:
[`docs/17`](../../docs/17-multi-agent-production-crew.md)).

A `Crew` runs a `flow` of role-specialised `Agent`s over a shared
`ProductionState`, records every decision + handoff to a `ProductionLog` (the
observable transcript), renders a take via a caller-supplied `execute`, and lets
a **critic** loop back to any role for a bounded number of rounds.

- **Fallback-first** — every `Agent` degrades to a deterministic function when
  its `LLM` is unavailable, so a crew always runs headless.
- **Model-agnostic** — agents talk to the `LLM` protocol; DeepSeek (default),
  Gemini, and Claude are swappable adapters (`llm_providers.py`), chosen per job
  from the admin panel.
- **Pure stdlib** — unit-tested on CPU with a scripted mock LLM.

```bash
cd clipcast-backend/crew && python test_crew.py   # CPU tests, no network
```

## Status — all phases built
- **Phase 1** (this package): the framework, CPU-tested.
- **Phase 2**: vendored into `apps/mixer` as the **music crew**
  (`music_crew.py`, docs/17 §3a).
- **Phase 3**: vendored into `apps/processor` as the **clip crew** with the
  dynamic **Colorist** (`clip_crew.py`, docs/17 §3b).
- **Phase 4**: the decision log is persisted to `UploadedFile.productionLog` and
  streamed to the **Production Room** UI (`/dashboard/production/[id]`, docs/18).

The `agents.py` in this package is the source of truth; each app carries a
synced `crew.py` copy so its Modal image builds without the repo root on path.
Keep them in sync — the tests here cover both.
