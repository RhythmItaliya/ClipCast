# ClipCast 17: the Multi-Agent Production Crew

> **Status: BUILT.** All six phases below are shipped (see the ✅ markers in
> §10). This doc is kept as the "deep think first" architecture for
> ClipCast's audio + clip pipelines running as a **film-production-style crew
> of AI agents** that understand the material emotionally, hand work to each
> other, argue/revise in a loop, and leave a visible trail of *why* every
> creative decision was made. Companion to [14](14-audio-studio-mode.md)–[16](16-ai-arrangement-and-audio-rating.md)
> (audio) and [13](13-clip-modes-and-ai.md) (clips). The crew runs on the
> admin-selected LLM (DeepSeek default / Gemini / Claude) and always degrades to
> deterministic fallbacks.

## 1. Why a crew, not a single prompt

Before the crew, each pipeline had *one* AI decision point — the LLM picks clip
moments (doc 13); the LLM writes one producer plan for the mixer (doc 16 + the
`_producer_plan`). That's a single director doing everything in one shot.

A real production has **specialists who pass work down a line and give each
other notes**: a writer drafts, a director shapes, a composer scores, an
engineer mixes, a critic sends it back. Each role sees the whole brief but owns
one decision, and the *conversation between them* is where quality comes from.

Two hard principles fall out of this, both things you asked for:

- **Everything dynamic, nothing hardcoded.** No lookup tables for colors, moods,
  instruments, or tempos. An agent *decides* the caption RGB from the clip's
  emotion; an agent *decides* the instrument palette from the lyric. The only
  constants are safety floors (min clip length, peak limiting) and fallbacks.
- **Emotion is the input.** Every crew starts by *understanding* — lyrics,
  tone, story, energy — and every downstream decision references that reading.

## 2. Core abstractions (shared `agents/` module)

One small, framework-style module reused by both the mixer and the processor,
so the pattern and code style are identical on both sides.

```
Agent            — one role. Has a name, a persona/system prompt, and a
                   decide(state) -> Decision method. Uses Gemini; every agent
                   has a deterministic fallback so the crew runs headless.
Decision         — structured JSON the agent returns (its choices) + a short
                   rationale ("why") + an optional handoff note to the next role.
ProductionState  — the shared "script": the brief (user request), the analysis
                   (audio/lyric/video facts), and every Decision made so far.
                   Passed agent → agent, append-only.
ProductionLog    — the observable transcript: an ordered list of
                   {from_role, to_role, decision, rationale, round, ts}. THIS is
                   what the observability service renders.
Crew / Showrunner— the orchestrator. Runs the agents in a defined flow, carries
                   the state, records the log, and runs the revision loop.
```

Design notes:
- **No hidden state.** An agent only reads `ProductionState`; it cannot reach
  around the crew. That makes the whole run reproducible from the log + seed.
- **Fallback-first.** If Gemini is unavailable, each agent returns a
  deterministic Decision (today's behavior), so a crew degrades to the current
  pipeline instead of failing — the same graceful-degradation rule the mixer
  already follows.
- **Model-agnostic.** `Agent` talks to an `LLM` interface. Gemini is the default;
  a role that benefits from another model/service (or a non-Python service) can
  swap its `LLM` without touching the crew. (You said polyglot is fine.)

## 3. The two crews

### 3a. Music crew (in `apps/mixer`)
| Role | Owns | Reads | Emits |
|------|------|-------|-------|
| **A&R / Brief** | restates the user's intent as a creative brief | user request, genre | brief |
| **Lyricist** | transcribe + interpret lyrics: emotion per line, themes, the hook | vocal stem (Whisper) | emotion map, hook lines |
| **Director** | the creative vision: mood, energy arc, what the edit is *about* | brief + emotion map | vision |
| **Composer** | the genre instrumental: the ACE-Step prompt + seed | vision + analysis (BPM/key) | bed spec |
| **Arranger/Producer** | which sections, transitions, melody re-instrument choice | vision + parts | arrangement |
| **Sound Engineer** | FX chain + mastering direction | arrangement | fx/master spec |
| **Critic (A&R return)** | scores the take (Audiobox) + writes notes back to a role | rendered take | score + revision note |

### 3b. Clip crew (in `apps/processor`)
| Role | Owns | Reads | Emits |
|------|------|-------|-------|
| **Story Editor** | which moments are genuinely clip-worthy + why | transcript, emotion | moment list |
| **Writer** | title + hook per clip | moment + transcript | titles |
| **Colorist** | the caption highlight **RGB**, decided from the clip's emotion | moment emotion | `{r,g,b}` (dynamic!) |
| **Director** | ranks/curates the final set, drops weak ones | all moments | ordered set |
| **Critic** | flags low-quality picks, sends notes back to the Story Editor | set | keep/revise |

The Colorist is the concrete answer to *"give full RGB, everything dynamic,
without any hard[code]"*: it replaces the hardcoded `_category_highlight_hex`
map with an agent that returns an RGB from the clip's felt emotion, per clip.

## 4. Message passing — "where they send to each other"

The Showrunner defines a **flow graph**, not a fixed line, so a role can hand
back as well as forward:

```
Music:  A&R → Lyricist → Director → Composer → Arranger → Engineer → Critic
                                   ↑___________________________________|
                              (Critic's notes re-enter at the addressed role)

Clip:   Story Editor → Writer → Colorist → Director → Critic
                     ↑______________________________|
```

Each `Decision` carries `to_role` + a `note`, so the handoff ("Composer, make
the drop sparser") is explicit and shows up verbatim in the log. The Showrunner
routes the next turn to `to_role`.

## 5. The Modal loop (the "full Modal loop")

The crew runs **inside the existing warm GPU container** (mixer `@app.cls`,
processor `@app.cls`) — no new always-on service. One job = one crew run:

```
render() {
  state = analyze()                     # stems, lyrics, BPM/key  (or transcript)
  for round in 1..MAX_ROUNDS {          # bounded agentic loop
     for role in flow: state += role.decide(state); log.append(...)
     take = execute(state)              # ACE-Step / DSP / ffmpeg render
     verdict = Critic.decide(state, take)
     if verdict.accept or round == MAX_ROUNDS: break
     flow = flow.reroute(verdict.to_role)   # loop back to the addressed role
  }
  return take, log
}
```

`MAX_ROUNDS` (e.g. 3) bounds cost. The heavy work (Demucs, warp, ACE-Step) is
cached across rounds exactly as the mixer already caches it — only the cheap
agent decisions + the FX/arrangement re-render repeat.

## 6. Observability service — "see the way they decide"

The `ProductionLog` is persisted per job and surfaced as a **Production Room**:

- **Storage:** a new `productionLog Json?` column on `UploadedFile` (and/or per
  `Clip`). The crew returns the log with its result; Inngest writes it.
- **Streaming (live):** the crew emits an Inngest event per Decision
  (`production-log-events`) so the queue can show the crew "talking" in real
  time, reusing the existing realtime-query plumbing (doc 10).
- **UI:** a `/dashboard/queue/[id]` (or a drawer) that renders the transcript as
  a chat between roles — each card = role, decision, rationale, and the handoff
  arrow to the next role, grouped by round, with the Critic's revision notes
  shown as the loop-back. Dynamic colors (from the Colorist) are previewed
  inline. This is the "high-level view of how the agents decided."
- **API:** `getProductionLog(jobId)` server action (owner-scoped), same auth
  pattern as `getClipUrl`.

## 7. What this refactors (no throwaway work)

- `apps/mixer`: `_producer_plan` / `_transcribe_lyrics` become the **Lyricist +
  Director + Composer** agents; `decide_mix_style` becomes an input the Director
  reads (not the final word). The ACE-Step/melody/FX code I built stays — it's
  the crew's **execution layer**.
- `apps/processor`: `identify_moments` becomes the **Story Editor + Director**;
  the hardcoded caption color map becomes the **Colorist agent** (the map stays
  only as the Colorist's fallback).
- `apps/composer` (ACE-Step) is unchanged — the Composer agent calls it.

## 8. Inngest + DB + frontend touch-points

- **DB:** `productionLog Json?` on `UploadedFile`; optionally `captionRgb` per
  `Clip` (the Colorist's pick, for display).
- **Inngest:** `processAudioFn` / `processVideoFn` pass through the log to the
  job record; a new lightweight `production-log-events` stream for live updates.
- **Frontend:** the Production Room view + a live "crew is working" indicator on
  the queue row; the Settings caption color gains an **"Auto (AI colorist)"**
  option (the default), with the manual picker still winning when set.

## 9. Code style + testing

- One `agents/` package per backend app (or a shared vendored copy), typed
  dataclasses for `Decision`/`ProductionState`, every agent < 40 lines, personas
  in a `personas.py` constant block.
- **CPU tests with a mock LLM:** inject a scripted `LLM` so the whole crew flow,
  routing, loop-back, and log shape are unit-tested deterministically with no
  network — mirrors `test_audio_engine.py`.
- **End-to-end:** the existing Modal smoke scripts (`audio-tests/`) extended to
  assert a well-formed `productionLog` + a rendered take, for both crews.

## 10. Phased build (each independently shippable)

1. **Framework** — `agents/` module (Agent/Decision/State/Log/Crew) + mock-LLM
   CPU tests. No behavior change yet. **✅ Built** (`clipcast-backend/crew`).
2. **Music crew** — port the mixer's director into the crew; add Composer/
   Arranger/Engineer/Critic; loop. Deterministic fallbacks = today's output.
   **✅ Built** (`apps/mixer/music_crew.py`): lyricist → director → composer →
   engineer produce the plan + ProductionLog that drives the render; headless
   fallbacks == the pre-crew plan; CPU-tested in `apps/mixer/test_music_crew.py`.
   (Currently a planning crew, `max_rounds=1`; the render-in-the-loop critic is
   a later refinement — the framework already supports it, §5.)
3. **Clip crew** — Story Editor/Writer/**Colorist**/Director/Critic; dynamic
   caption RGB replaces the hardcoded map. **✅ Built**
   (`apps/processor/clip_crew.py`): the **Colorist** decides the caption
   highlight RGB per clip from its emotion (transcript snippet + category), the
   category map is only its fallback, and a job-level `production_log` is
   returned. CPU-tested in `apps/processor/test_clip_crew.py`.
4. **Observability** — persist + stream the log; the Production Room UI.
   **✅ Built (persist + view)**: `UploadedFile.productionLog Json?`; both
   inngest functions write it; `getProductionLog` server action; the
   **Production Room** page (`/dashboard/production/[id]`) renders the crew's
   transcript round-by-round with role handoffs, rationales, and a live RGB
   swatch for the Colorist's pick; linked from each clip group. (Live *streaming*
   of the log during a run is the remaining piece.)
5. **Polish** — live crew indicator, "Auto colorist" settings option, docs.
   Partial: caption auto-color is already the default; the explicit settings
   toggle + live streaming indicator remain.
6. **Monitoring** — **✅ Built**: a `Tracer` hook on the crew emits every
   decision, retry round, and agent failure; `crew/monitoring.py` maps it to
   **Langfuse** (free/OSS) when `LANGFUSE_*` keys are set, else no-ops. Both
   crews now run with `max_rounds=2` so the critic can reject a take and redo it
   (like a studio). See [18](18-agent-monitoring.md) for setup + where compute
   runs (all on Modal, nothing heavy on your PC).

## 11. Risks & guardrails

- **Cost:** every agent is a Gemini call; `MAX_ROUNDS` + caching bound it, and
  fallbacks make the crew free when Gemini is down. Flash-tier, short prompts.
- **Latency:** agent turns are seconds; the loop reuses cached heavy artifacts.
- **Determinism:** seeds + the log make any run reproducible/debuggable.
- **Quality is still ears-only on GPU** — the crew improves *decisions*, not the
  fact that vocal-on-generated-bed alignment needs listening (doc 16 caveat).
