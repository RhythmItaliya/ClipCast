# ClipCast 13: Clip modes & AI moment selection

## Modes the user can pick

`All`, `Any`, `Q&A`, `Educational`, `Motivational`, `Highlights`
(uploader pills, `CLIP_MODES` in `uploader.tsx`).

- Fixed modes run one targeted Gemini prompt; if nothing matches (e.g. no
  Q&A in the video) the job fails with a clear no-charge message.
- **Any**: fully open-ended — the model first infers what kind of episode it
  is (comedy, true crime, debate ...), finds the best moments of any type,
  and invents a 1-3 word `category` tag per clip ("Hot Take", "Sad Story").
- **All**: exhaustive fan-out — a full pass per mode in
  `ALL_FANOUT_MODES = [qa, educational, motivational, highlights, any]`,
  results merged with >50% duration-overlap dedupe (`_overlaps`). ~5x the
  Gemini calls, billed at 1.5x (see doc 07).

## Pipeline (`apps/processor/main.py`)

1. `transcribe_video`: WhisperX large-v2 + alignment → per-word timestamps
   (also feeds captions).
2. `_build_sentence_transcript` + `_chunk_sentences`: compact sentence rows,
   windowed so 4-hour sources cost the same per call as 20-minute ones.
3. `identify_moments`: per chunk, Gemini 2.5 Flash (`thinking_budget: 0`,
   `max_output_tokens: 8192`); on parse/API failure falls back to a resident
   HF model (Qwen2.5-7B-Instruct) per chunk. Returns moments + a per-chunk
   source summary that becomes the job's human-readable
   `processingSummary`.
4. Validation: bounded count (12), duration sanity (0 < len <= 120s, inside
   the video), titles capped.
5. Per-clip category flows back to the frontend
   (`clips[].category`) and is stored as `Clip.clipMode` — so an "All" job's
   clips carry their real per-clip label, not the blanket job mode. Fixed
   modes map to display labels via `MODE_CATEGORY_LABELS`; "any" keeps the
   AI-invented tag (fallback "Moment").

## Prompt contract

Every prompt demands strict JSON `[{start, end, title(, category)}]` on
sentence boundaries, no overlaps, ~1 clip / 5 minutes, 40-60s targets, and
excludes greetings/filler. `_clean_and_validate` strips code fences and
repairs truncated arrays before parsing.

## Auto-clip (daily cron)

`dailyClipScheduler` (09:00 UTC): for users with a connected channel,
`youtubeAutoClip = true` and credits > 0, refreshes the Google token,
fetches the channel's latest upload, skips if that URL was already imported
(idempotent), then creates the job in `highlights` mode via the normal
`process-video-events` path. Toggle lives on the YouTube page
(`setYouTubeAutoClip`), and is reset on disconnect.
