# ClipCast 14: Audio Studio mode (AI music + YouTube mashups)

> **Status: plan only.** No code exists for this yet. This document is the
> end-to-end design: what the feature does, the exact open-source tool for
> every stage and why, how it slots into the existing ClipCast architecture,
> and the order to build it in. Read [00-overview.md](00-overview.md),
> [05-uploads-and-queue.md](05-uploads-and-queue.md), and
> [06-video-processing-pipeline.md](06-video-processing-pipeline.md) first —
> this mode reuses all three (downloader, Inngest queue, Modal GPU pattern).

## What it does

A new job type, separate from clip generation. Two sub-modes the user picks
before submitting:

- **Sub-mode A — Generate ("AI makes audio for me")**: user types a text
  prompt (and optionally lyrics + a style/language, e.g. *Hindi lofi love
  song, 90 BPM*). We generate an original track with an open music model.
  No YouTube input.
- **Sub-mode B — Mashup ("mix two songs")**: user pastes **two YouTube
  URLs** (e.g. a Hindi track and an English track). We pull the audio,
  split each into vocals + instrumental, detect tempo/key/beat-grid on
  both, tempo- and key-match them, and lay the **vocal (acapella) of song A
  over the instrumental of song B**, beat-aligned, then mix and master to a
  clean, release-ready file. This is the Hindi×English / English×English
  mashup the user asked for.

Output of both: a finished audio file (WAV master + MP3) in S3, plus an
optional simple video (waveform/cover visualizer) so the result is directly
postable as a Reel/Short — reusing the existing clip delivery UI.

**Everything below is free and open-source.** Where an open model has a
non-commercial weight license, it is called out explicitly so the licensing
decision is made on purpose, not by accident.

## Why a separate Modal app (`apps/mixer`)

Same reasoning that split the downloader from the processor (doc 06): the
workloads are different shapes and should scale independently.

- Music generation (ACE-Step / MusicGen) and stem separation (Demucs) are
  **GPU-bound**; tempo/key analysis and the final ffmpeg mix are
  **CPU-bound**. Keep the GPU container doing only GPU work.
- It never touches the database — same "in bytes, out bytes" contract as the
  processor, authenticated with the shared bearer token
  (`PROCESS_VIDEO_ENDPOINT_AUTH`). Job rows, credits, and status stay the
  frontend's job via a new Inngest function.
- Reuse the **existing downloader app unchanged** for sub-mode B — it already
  turns a YouTube URL into a source file in S3 through the rotating free-proxy
  path ([youtube-proxy-architecture]). The mixer downloads that source from
  S3 and extracts audio with `ffmpeg -vn`, exactly like the processor does.

```
                         apps/mixer  (new Modal app)
  ┌───────────────────────────────────────────────────────────────┐
  │  GPU (L40S)                          CPU                        │
  │  • ACE-Step / MusicGen (generate)    • librosa/madmom analysis  │
  │  • Demucs v4 stem split              • rubberband stretch/shift │
  │                                      • pedalboard + ffmpeg mix  │
  └───────────────────────────────────────────────────────────────┘
        ▲  reads source(s) from S3 (via existing downloader)
        ▼  writes stems + final master to S3
```

## The open-source stack (every stage, the pick, and the alternative)

| Stage | Recommended (free / OSS) | License note | Alternatives |
|---|---|---|---|
| YouTube → source in S3 | **existing downloader** (yt-dlp + proxies) | — | reuse as-is (doc 06) |
| Audio extract / final encode | **ffmpeg** | LGPL/GPL | — |
| Text→music (instrumental) | **ACE-Step** | Apache-2.0, commercial-OK | MusicGen (code MIT, some weights CC-BY-NC), Stable Audio Open (community license) |
| Text→**full song w/ vocals+lyrics** | **YuE** | Apache-2.0 | DiffRhythm, ACE-Step (also does vocals) |
| Stem separation (vocals/instrumental) | **Demucs v4** (`htdemucs_ft`) | MIT | MDX-Net, Spleeter (older, weaker) |
| Tempo / beat / downbeat grid | **madmom** (DBNDownBeat) + **librosa** | BSD / ISC | BeatNet, Essentia |
| Musical **key** (for harmonic mixing) | **Essentia** KeyExtractor | AGPL (self-hosted, fine) | librosa chroma + Krumhansl-Schmuckler |
| Song **structure** (intro/verse/chorus) | **allin1** (All-In-One analyzer) | MIT | MSAF |
| Tempo stretch + pitch shift (HQ) | **Rubber Band** (`pyrubberband`) | GPL (CLI, self-hosted, fine) | librosa phase-vocoder (lower quality) |
| Arrangement brain ("smart mashup") | **Gemini 2.5 Flash** (already in stack) | — | local Qwen fallback (already in stack) |
| Mixing / EQ / effects | **pedalboard** (Spotify) | GPL-3 | ffmpeg `amix`/`acrossfade`, pydub |
| Loudness normalize (broadcast) | **pyloudnorm** / ffmpeg `loudnorm` | MIT | — |
| Optional master polish | **Matchering** (reference master) | GPL-3 | skip; ffmpeg loudnorm is enough for v1 |
| Optional output visualizer video | **ffmpeg** `showwaves`/`showcqt` | — | still cover image + audio |

**Harmonic mixing** itself is not a library — it's Camelot-wheel logic on top
of the detected key (a small pure-Python table): two tracks mix cleanly if
they share a Camelot code or are ±1 / relative major-minor apart. We shift the
smaller-move track to a compatible key rather than force a clash.

## Sub-mode A — Generate, end to end

1. **Input**: text prompt + optional lyrics + duration + language/style tags.
   Frontend collects these on the Audio Studio page (see UX below).
2. **Route by request**: lyrics present → **YuE** (full song with sung
   vocals, supports multilingual incl. Hindi/English). Instrumental only →
   **ACE-Step** (fast, Apache-2.0, commercial-safe) or **MusicGen** with a
   melody prompt.
3. **Generate** on the GPU container (`@modal.enter()` keeps weights resident,
   same warm-model pattern as the processor's WhisperX load).
4. **Post-process**: trim silence, `loudnorm` to a consistent target
   (~-14 LUFS for social), encode WAV + MP3.
5. **Output**: upload to S3, return `{s3_key, duration, title, ...}` — the
   same record shape the frontend already maps into a row.

This sub-mode is the smaller build and a good **milestone 1**: no separation,
no matching, just generate → normalize → store.

### Genre support (lofi, ambient, and everything else) — free models only

The user picks a **genre/style** on the form; we never hand the raw model a
bare prompt. Each genre is a **preset** — a curated prompt template + default
BPM range + mood tags — so "lofi" reliably sounds like lofi. This is a data
table, not model work.

| Genre preset | Prompt seed the model gets | Default BPM |
|---|---|---|
| Lofi / chill | "lofi hip-hop, mellow, vinyl crackle, jazzy keys, relaxed" | 70-90 |
| Ambient | "ambient, atmospheric pads, no drums, evolving textures, calm" | — (beatless) |
| Cinematic / epic | "cinematic orchestral, strings, building, emotional" | 60-90 |
| Trap / hip-hop | "trap beat, 808 bass, hi-hat rolls, hard" | 130-150 (half-time feel) |
| EDM / house | "house, four-on-the-floor, synth stabs, energetic" | 120-128 |
| Pop | "modern pop, catchy, bright, radio" | 100-120 |
| Bollywood / Indian | "Bollywood, dholak, tabla, Indian melody" | 90-120 |
| Rock | "rock, electric guitar, live drums, driving" | 110-140 |
| **Custom** | user's free-text prompt, used verbatim | user-set |

Add presets by appending rows — no code change to the model call. The preset
just fills the text prompt + BPM/key defaults that already flow through the
pipeline.

**Which free/open AI covers which genre — all run on Modal GPU, all free:**

- **ACE-Step** (Apache-2.0) — **the default for every genre**. It's the newest
  (2025) open foundation model, fast, commercially free, and steerable by genre
  tags. Handles lofi, ambient, EDM, cinematic, etc. from the preset tags.
- **YuE** (Apache-2.0) — when the preset needs **sung vocals + lyrics** (pop,
  Bollywood, rap); multilingual, so Hindi/English lyrics work.
- **Stable Audio Open** (community license, non-commercial) — strong on
  **ambient / textures / sound design**; use it as the ambient specialist *if*
  the non-commercial license is acceptable, else stay on ACE-Step.
- **MusicGen-melody** (code MIT; melody weights CC-BY-NC) — optional, when the
  user wants generation guided by a **hummed/uploaded melody**; note the
  non-commercial weight.

**Commercially-safe default path = ACE-Step (instrumental, any genre) + YuE
(vocals).** Both Apache-2.0, both resident on the mixer's Modal GPU via
`@modal.enter()` — no per-genre model swap, the genre is just the prompt. The
non-commercial models (Stable Audio Open, MusicGen weights) are *optional
upgrades* flagged so the licensing choice is deliberate (see Risks).

For **mashups**, the same genre preset can steer the "generate a fresh beat"
option (sub-mode B, new-beat mode 2 in doc 15) — e.g. mash two vocals over a
new *lofi* or *ambient* bed at the matched BPM/key.

## Sub-mode B — Mashup, the pipeline

This is the core request. Seven stages; stages 2-4 are the "make it a perfect
beat mix" work. **For the plain-language "how do you actually join two songs
and make a new beat" explanation of everything below — stem swapping, beat/grid
alignment, key matching, transitions, making a new beat — see
[15-mashup-mixing-mechanics.md](15-mashup-mixing-mechanics.md).**

### Stage 1 — Ingest both tracks

Reuse the downloader for each URL (fan out two downloads), then in the mixer
`ffmpeg -i source.mp4 -vn -acodec pcm_s16le -ar 44100 -ac 2 songN.wav`. Keep
44.1 kHz stereo for music (the processor uses 16 kHz mono, which is right for
speech but wrong here).

### Stage 2 — Stem separation (Demucs v4)

Run **Demucs `htdemucs_ft`** on both tracks → `vocals / drums / bass / other`
for each. For a classic vocal-over-instrumental mashup we need:

- **Song A** → keep `vocals` stem (the acapella that carries the topline).
- **Song B** → keep the instrumental = `drums + bass + other` summed (or the
  no-vocals mix).

Demucs is GPU and the heaviest step; run it on the L40S. `htdemucs_ft` (the
fine-tuned variant) is slower but noticeably cleaner on vocals, which matters
because vocal-stem artifacts are the most audible failure in a mashup.

### Stage 3 — Musical analysis (both tracks)

On CPU, per track:

- **Tempo + beat + downbeat grid** — madmom's `DBNDownBeatTrackingProcessor`
  for a real downbeat grid (bar starts), librosa as a cross-check on global
  BPM. The downbeat grid is what we align to; matching plain BPM without
  aligning bar-ones produces a mix that is "in tempo" but off-phase.
- **Key** — Essentia `KeyExtractor` → root + scale, mapped to a **Camelot
  code**.
- **Structure** — **allin1** to label sections (intro / verse / chorus /
  bridge) with timestamps, so the arrangement can drop the vocal on song B's
  chorus instead of a random offset.

### Stage 4 — Tempo & key matching (the "beat sync")

The two songs almost never share a tempo or key. Decision policy:

1. **Target tempo**: default to song B's BPM (the instrumental bed defines the
   groove). If the two BPMs are within a large ratio (>~1.3×), consider
   half/double-time so we stretch the smaller amount and avoid artifacts.
2. **Time-stretch song A's vocal to the target BPM** with **Rubber Band**
   (`pyrubberband.time_stretch`) — formant-preserving, far cleaner than a
   phase vocoder on vocals.
3. **Key match**: compute Camelot distance. If incompatible, **pitch-shift**
   the vocal (`pyrubberband.pitch_shift`, semitone move) to the nearest
   compatible key, preferring the smaller shift so the voice stays natural.
4. **Phase-align**: line up song A's downbeat grid to song B's — offset the
   vocal so its bar-ones sit on the instrumental's bar-ones.

Rubber Band does stretch and shift independently, so tempo-lock and key-lock
don't fight each other.

### Stage 5 — Arrangement (AI-assisted, reuses Gemini)

Instead of a blind full-length overlay, feed the **section maps** (from
allin1) of both tracks to **Gemini 2.5 Flash** — the exact model and
JSON-contract pattern already used for clip moment selection (doc 13) — and
ask for a mashup arrangement plan:

```
[{ "instrumental_section": "chorus@72.0-96.0",
   "vocal_section": "chorus@40.0-64.0",
   "action": "overlay", "gain_db": -1.0 }, ...]
```

with rules: land vocal choruses on instrumental choruses, use instrumental-only
intro/outro as build-up/break, no vocal over song B's own surviving vocal
moments. On parse/API failure, fall back to the same **local Qwen** model the
processor already carries, or to a deterministic "overlay full vocal from the
first downbeat" default. This is where the mix becomes *musical* rather than a
naive layer — and it costs no new infrastructure, it's the stack we already run.

### Stage 6 — Mix & master

- Sum instrumental + aligned vocal. Simple gain automation from the Gemini
  plan (duck instrumental slightly under vocal choruses).
- **pedalboard** for a light channel strip: high-pass the vocal, gentle
  compression, a touch of reverb to glue A onto B.
- **acrossfade** at section joins so transitions aren't hard cuts.
- **Loudness**: `pyloudnorm` / ffmpeg `loudnorm` to ~-14 LUFS integrated.
- Optional **Matchering** pass against a reference track for a more "released"
  master — leave out of v1.

### Stage 7 — Render & deliver

- Encode WAV (master) + MP3 (share) → S3.
- Optional **visualizer video**: ffmpeg `showcqt`/`showwaves` over a cover
  image → MP4, so the mashup is directly postable and reuses the existing clip
  card / download UI.
- Return the structured record(s) to the frontend, same shape as clips.

## How it wires into the existing app (no new infra category)

- **Frontend / UX** — a new **Audio Studio** page under `dashboard/`, mode
  toggle Generate | Mashup. Generate shows a prompt + lyrics + style form;
  Mashup shows two YouTube URL fields + a "who sings / who plays" swap and a
  target-BPM override. Follows the existing uploader/mode-pill pattern
  ([clipcast-by-me-ui-port]) and shared-types convention
  ([shared-types-convention]).
- **Queue** — a new Inngest function `process-audio-events` mirroring
  `process-video-events` (doc 05): check credits → (fan out downloads for
  mashup) → call the mixer Modal endpoint → write result rows → deduct credits
  → notify. Multi-minute GPU work stays inside Inngest steps, same as today.
- **Backend** — new Modal app `apps/mixer` with a bearer-authed
  `@modal.fastapi_endpoint` `process_audio`, warm models via `@modal.enter()`,
  `max_containers` small (GPU is the bottleneck), stateless.
- **Storage** — S3 keys namespaced `audio/{jobId}/...` for stems + master +
  visualizer, presigned on read exactly like clip thumbnails.
- **Data model** — reuse the existing job/clip tables where possible: a job
  gets a `type` (`clip` | `audio`) and mashups produce a `Clip`-like row whose
  media is audio/visualizer. Prefer extending over a parallel schema; if a
  dedicated `AudioTrack` model is cleaner, add it alongside. **Verify any new
  Prisma `select` against a live DB script — tsc won't catch a wrong field**
  ([prisma-select-typing-gotcha]).
- **Billing** — audio jobs cost credits like clip jobs (doc 07). Suggested:
  Generate = 1 unit; Mashup = more (two downloads + two Demucs passes +
  analysis + render). Set the multiplier once the real GPU-seconds are
  measured, the way the All-mode 1.5× multiplier was set.

## Build order (milestones)

1. **Generate-only** (sub-mode A, instrumental): ACE-Step → loudnorm → S3.
   Proves the mixer app, the Inngest function, the Audio Studio page, and
   billing end to end with the least moving parts.
2. **Add vocals to Generate**: route lyric prompts to YuE.
3. **Mashup happy path**: two URLs → Demucs → naive full-vocal overlay at
   matched BPM (Rubber Band) → mix → S3. No key match, no AI arrangement yet.
4. **Harmonic mixing**: add Essentia key detection + Camelot shift.
5. **Smart arrangement**: allin1 structure + Gemini arrangement plan + section
   crossfades.
6. **Polish**: pedalboard channel strip, Matchering, visualizer video.

Ship 1-3 first; they already give the user a working "mix two songs" button.
4-6 are quality, not correctness.

## Risks & open questions

- **Copyright / ToS**: mashups of copyrighted YouTube audio are the whole
  point but are a legal/distribution risk. Decide whether output is
  private-only, and add a clear in-product notice. This is a product decision,
  not a technical one — flag before launch.
- **Weight licenses**: MusicGen melody weights and Stable Audio Open are
  **non-commercial / community** licensed; ACE-Step and YuE (Apache-2.0) and
  Demucs (MIT) are the commercially-safe defaults. Essentia (AGPL) and Rubber
  Band / pedalboard (GPL) are fine self-hosted on Modal but keep them
  server-side.
- **Vocal-stem artifacts** are the most audible failure; `htdemucs_ft` + a
  gentle vocal channel strip mitigate but don't eliminate — set user
  expectations.
- **Analysis cost**: allin1 + madmom + Essentia on two full songs adds CPU
  minutes; window/parallelize if it dominates latency.
- **GPU footprint**: Demucs + a resident music model on one L40S needs a VRAM
  check (same headroom reasoning as the Qwen fallback in doc 06); lazy-load
  the generation model if only mashup is requested.

## Diagram (to add)

`docs/excalidraw/05-audio-studio.excalidraw` — two-URL ingest → Demucs stems
→ analysis (BPM/key/structure) → match (stretch/shift/align) → Gemini
arrangement → mix/master → S3, with the Generate sub-mode as a short parallel
branch. Mirror the numbering of the existing per-flow sketches (doc 06).
