# clipcast-mixer — Audio Studio engine (Modal, GPU)

The third Modal app, alongside `downloader` and `processor`. It is **fully
independent** of them: its own image, its own torch pin (2.4.1, newer than the
processor's WhisperX-locked 2.2.2), its own Modal app name (`clipcast-mixer`).
It **cannot affect the clip pipeline** — nothing here imports from the other
apps, and the frontend clip flow never calls it.

Design and rationale: [`docs/14-audio-studio-mode.md`](../../../docs/14-audio-studio-mode.md)
and [`docs/15-mashup-mixing-mechanics.md`](../../../docs/15-mashup-mixing-mechanics.md).

One warm `@app.cls` container (`ClipCastMixer`) keeps Gemini and the
Audiobox-Aesthetics rater resident across jobs via `@modal.enter()`, like the
processor's model class. A tiny separate CPU function is only the submit/poll
router — it spawns the warm GPU class method.

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
POST /process_audio  { mode, out_prefix, ... }   -> 202 { call_id }
POST /process_audio  { call_id }                 -> 202 pending | 200 { s3_key, wav_s3_key, duration, title, processing_summary }
```

Auth: `Authorization: Bearer $PROCESS_VIDEO_ENDPOINT_AUTH` (the shared token).
Storage: reads/writes `S3_BUCKET_NAME`. Both from the `clipcast-secret` Modal
secret — no new secrets. Outputs land at `{out_prefix}master.mp3` and
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
processor's `captions.py`:

```bash
python apps/mixer/test_audio_engine.py
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
