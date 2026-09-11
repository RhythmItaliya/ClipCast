# ClipCast 16: AI arrangement + audio-quality rating loop

> **Update (viral hook-edit redesign):** the mashup is now a short (≤59s)
> two-part **hook edit** — find each source's catchiest window, keep the tune
> when the vocal doesn't fit, join two parts with a beat-matched transition, and
> finish with a pedalboard FX chain. The Gemini offset-arrangement and the
> lyric-transcription/energy-section steps described below were **removed**;
> hook detection (`detect_hook`), `is_tune_only`, `apply_fx_chain`, and
> `decide_edit_length` replace them. The **rating loop is kept**, but it now
> retries over FX presets (viral → clean) instead of ducking params. See the
> `apps/mixer/README.md` and `AUDIO_STUDIO_SUMMARY.txt` for the current flow.
>
> **Provider note:** "Gemini" below is one example provider. The AI decisions now
> run on the admin-selected LLM — **DeepSeek** (default), **Gemini**, or
> **Claude** (`apps/mixer/llm_providers.py`, docs/17) — and always fall back to
> deterministic logic when none is reachable.

> Companion to [14](14-audio-studio-mode.md) and [15](15-mashup-mixing-mechanics.md).
> Those cover *what* a mashup is and the mixing mechanics; this covers the two
> pieces that make the mix **decided and judged by AI**, not by fixed rules:
> the arrangement brain and the rating feedback loop. Implemented in
> `clipcast-backend/apps/mixer/` (`main.py` + `audio_engine.py`), CPU-tested in
> `test_audio_engine.py`.

## One warm container

Everything runs in a single Modal `@app.cls` (`ClipCastMixer`). `@modal.enter()`
loads the Gemini client and the Audiobox-Aesthetics rater once per container and
keeps them warm across jobs — the processor's model-class pattern (doc 06). A
tiny separate CPU function is only the submit/poll router; it spawns the warm
GPU class method. Best separation model: **Demucs `htdemucs_ft`** (fine-tuned,
cleanest vocals).

## 1. The AI arrangement brain (`_arrange`)

After stem-splitting and tempo/key-matching, both tracks are cut into
**sections** with an energy score each (`detect_sections` — librosa
agglomerative clustering on chroma). Those two section lists go to **Gemini
2.5 Flash** — the same model and JSON-contract discipline the clip pipeline
already uses (doc 13) — which returns a DJ arrangement:

```json
{ "offset_sec": 41.0, "vocal_gain_db": -1.0, "bed_gain_db": -3.0,
  "duck_db": -4.0, "intro_build_sec": 4.0 }
```

The rule it's asked to follow: land the vocal's **highest-energy hook** on the
bed's **highest-energy drop**, and pick gentle DJ treatment. Every value is
clamped server-side to a safe range. If Gemini is unavailable or returns
unparseable JSON, `plan_arrangement_fallback` does the same thing
deterministically (align the loudest sections) — the pipeline never hard-fails
on the AI step.

The chosen plan is *applied* by deterministic, tested DSP in `audio_engine.py`:

- **`duck_bed`** — sidechain-style: the bed drops by `duck_db` wherever the
  vocal is present, smoothed so it swells back with no clicks. This is "one
  clean voice over one clean bed" made audible.
- **`render_mashup`** — places the vocal at `offset_sec`, applies the duck, an
  optional high-pass **intro build** (`intro_build_sec`) for tension→release,
  gain-stages, and guards against clipping.
- **`crossfade`** / **`highpass`** / **`lowpass`** — the transition toolbox
  (doc 15) as composable primitives.

Split of responsibility: **AI decides, tested code applies.** The unpredictable
part (musical taste) is the model's; the deterministic part (sample math) is
unit-tested and can't regress silently.

## 2. The rating feedback loop

We don't trust a single render. After mixing we **score the audio and re-mix if
it's not good enough**, using **Meta Audiobox-Aesthetics** — an open model that
predicts four 1-10 aesthetic axes; we optimize **Production Quality (PQ)**:

```
params = arrangement's mix params
best = None
for attempt in 1..3:
    mix   = normalize_loudness(render_mashup(vocal, bed, offset, params))
    score = rater.PQ(mix)                 # Audiobox-Aesthetics
    best  = max(best, (score, mix))       # keep the highest-PQ take
    if score is None or score >= 7.5: break
    params = next_mix_params(params)      # back the vocal off, duck harder
```

`next_mix_params` is a bounded, monotonic hill-climb: the two most common fixes
for a low-quality mashup (vocal too hot, bed too muddy) are to reduce the vocal
gain and increase the ducking, so each retry does exactly that and always
terminates. The **best-scoring take** is what gets encoded and uploaded, and the
PQ score is recorded in the job's `processingSummary` (visible in the queue/admin
tooltip, like the clip pipeline's model summary).

If the rater can't load, the loop runs once un-scored and ships that take —
graceful degradation, never a failure.

## Why these tools

| Need | Tool | Why |
|---|---|---|
| Best vocal separation | Demucs `htdemucs_ft` | MIT, cleanest open vocal stem |
| Arrangement decision | Gemini 2.5 Flash | already in the stack (doc 13); good at constrained JSON |
| Audio quality score | Audiobox-Aesthetics | open, predicts Production Quality directly — exactly the "software that rates the audio" the loop needs |
| Apply decisions | numpy/scipy DSP | deterministic + unit-tested (`test_audio_engine.py`) |

## Testing

`python apps/mixer/test_audio_engine.py` (CPU, no GPU/network) covers the
deterministic half end to end: section energy, ducking actually lowering the bed
under the vocal, seamless crossfade length, the arrangement landing the hook on
the drop, render clip-safety, and the feedback loop's bounded back-off. The AI
calls (Gemini, Audiobox) are exercised on a real deploy — treat the first
mashup as the integration smoke test, the way `test_pipeline.py` does for clips.

## Next

Build-order upgrades still open (docs/15): madmom downbeat grid, Essentia key,
allin1 labelled sections, bass-swap EQ between two beds, and optional Matchering
reference master.
