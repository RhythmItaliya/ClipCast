# clipcast-mixer — Audio Studio engine (Modal, GPU)

One of the four Modal apps, alongside `downloader`, `processor`, and `composer`.
It is **fully independent** of the clip pipeline: its own image, its own torch
pin (2.4.1, newer than the processor's WhisperX-locked 2.2.2), its own Modal app
name (`clipcast-mixer`). It **cannot affect the clip pipeline** — nothing here
imports from the other apps, and the frontend clip flow never calls it. It does
call the isolated **`composer`** app (ACE-Step) by name for the neural genre bed,
with a bounded timeout and a deterministic fallback so a mix never depends on it.

Design and rationale: [`docs/14-audio-studio-mode.md`](../../../docs/14-audio-studio-mode.md),
[`docs/15`](../../../docs/15-mashup-mixing-mechanics.md), [`docs/16`](../../../docs/16-ai-arrangement-and-audio-rating.md),
the AI crew ([`docs/17`](../../../docs/17-multi-agent-production-crew.md)), and
Song Research ([`docs/19`](../../../docs/19-song-research-agent.md)).

One warm `@app.cls` container (`ClipCastMixer`) keeps the LLM provider client and
the Audiobox-Aesthetics rater resident across jobs via `@modal.enter()`, like the
processor's model class. A tiny separate CPU function is only the submit/poll
router — it spawns the warm GPU class method. The AI decisions run on the
admin-selected provider (`llm_provider`: DeepSeek default / Gemini / Claude,
`llm_providers.py`), always with deterministic fallbacks.

## What runs per mashup

Song Research (`research.py`, docs/19) identifies each source and fetches its
real lyrics + viral moment; the **music crew** (`music_crew.py`, docs/17 §3a:
lyricist → director → composer → engineer → critic) turns that into a production
plan; `audio_engine.py` executes it (stem split, beat/key match, transition, FX,
rating loop). Every crew decision is recorded to the job's `production_log`.

## Two modes

- **`generate`** — text + genre → an original track. MusicGen (`facebook/
  musicgen-medium`) is the codepath here for reliable unattended deploys; swap
  `_generate` in `main.py` for **ACE-Step** (Apache-2.0) for a commercially-safe
  path — the rest of the pipeline is unchanged.
- **`mashup`** — a **viral hook edit** ("X × ABC"). One or more S3 sources
  (placed there by the `downloader` app, or uploaded) → **Demucs `htdemucs_ft`
  4-stem** extraction (vocals / drums / bass / other) → per source, find the
  **catchiest window** (`detect_hook`) and keep just the **tune** when the vocal
  doesn't fit (`is_tune_only`) → re-produce the bed on its own beat grid → warp
  both parts to one tempo/key (Rubber Band + Camelot) → join them with a
  **beat-matched transition** → **BandLab-style FX chain** (`apply_fx_chain`,
  pedalboard: EQ / comp / air / reverb / limiter) → cap to a short **viral
  length** (AI-decided from tempo, hard ≤59s) → **rating-feedback loop**
  (Audiobox-Aesthetics Production-Quality; retry with a cleaner FX preset, keep
  the best take) → loudness master → S3. Two sources → one hook each; a single
  source → its two best hooks. Length is auto unless `remix_duration_seconds` is
  set. See [`docs/16`](../../../docs/16-ai-arrangement-and-audio-rating.md).

## Contract (stateless, same as the other apps)

Submit/poll, identical shape to the downloader so the Inngest queue reuses its
polling code:

```
POST /process_audio  { mode, out_prefix, genre, prompt, sources, llm_provider, ... }
                                                 -> 202 { call_id }
POST /process_audio  { call_id }                 -> 202 pending | 200 { s3_key, wav_s3_key, duration, title, processing_summary, production_log }
```

Auth: `Authorization: Bearer $PROCESS_VIDEO_ENDPOINT_AUTH` (the shared token).
Storage: reads/writes `S3_BUCKET_NAME`. The LLM provider keys come from the same
`clipcast-secret` Modal secret. Outputs land at `{out_prefix}master.mp3` and
`{out_prefix}master.wav`; the frontend picks the prefix (`audio/<jobId>/`) and
presigns on read, exactly like clip thumbnails.

Job rows, credits, and status are **not** this app's concern — same "in bytes,
out bytes" rule as `processor` (see `docs/06`).

## Deploy

```bash
./apps/mixer/deploy.sh        # modal deploy main.py
```

First mashup/generate per model downloads weights into the
`clipcast-mixer-models` volume; subsequent jobs are warm.

## Test without a GPU

The musical logic (Camelot matching, tempo folding, key-shift choice, loudness,
mix alignment) lives in `audio_engine.py` and is CPU-testable, like the
processor's `captions.py`. The music crew (mock LLM) and Song Research (mocked
`urllib`) are CPU-tested too:

```bash
python apps/mixer/test_audio_engine.py
python apps/mixer/test_music_crew.py
python apps/mixer/test_research.py
```

## Known limitations (documented upgrades in docs/15, docs/16)

- Hook detection scores loudness + onset energy over sliding windows, not a true
  madmom downbeat grid or allin1 chorus labels.
- Beat alignment warps to a single target BPM per part, not a per-bar time-map.
- Key detection is librosa chroma + Krumhansl-Schmuckler, not Essentia.
- The rating loop optimizes Production Quality only, over two FX presets.

None of these block a working, self-rated viral hook edit; they are quality
milestones. If pedalboard or the rater is unavailable, the pipeline degrades
gracefully (scipy FX fallback; single un-scored take).
