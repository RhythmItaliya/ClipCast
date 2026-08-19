# `clipcast` (Modal app — GPU processor)

The actual clip-making pipeline. Runs on an **L40S GPU** container: takes a
source video already in S3, transcribes it, asks the selected LLM (DeepSeek
default / Gemini / Claude) which moments are clip-worthy and ranks them for
virality, reframes each moment to vertical 9:16 around whoever is speaking, lets
the Colorist crew pick the caption color, burns in captions, and uploads the
finished clips back to S3.

## Endpoint

`process_video` — `POST`, `@modal.fastapi_endpoint` on the `ClipCast` class
(`main.py`), bearer-token protected (`PROCESS_VIDEO_ENDPOINT_AUTH`).

Request body (`ProcessVideoRequest`): `s3_key` (source video already uploaded —
see [`../downloader`](../downloader/README.md) for how it got there),
`clip_mode` (`qa` | `educational` | `motivational` | `highlights` | `all` |
`any`), `preview_only` (skip active-speaker detection + subtitles for a fast
low-res preview), `caption_color` / `watermark_text` (per-user branding, doc 12),
and `llm_provider` (`deepseek` | `gemini` | `claude` — the admin-selected
provider for moment selection + the crew).

Called from the frontend's Inngest function (`processVideoFn` in
`clipcast-frontend/src/inngest/functions.ts`) via `step.fetch` (not a plain
`fetch` — Inngest's step primitive tolerates the multi-minute processing time
without hitting a serverless function timeout).

## Pipeline, step by step (`process_video` → helper functions in `main.py`)

1. **Download the source** — `boto3` pulls `s3_key` from `S3_BUCKET_NAME` into
   the container's local scratch disk.
2. **Extract audio** — `ffmpeg` strips the video to 16kHz mono WAV.
3. **Transcribe** — `transcribe_video()` runs **WhisperX** (`large-v2`, loaded
   once per container in `load_model()` via `@modal.enter()`, kept resident
   across requests) plus forced alignment, returning word-level timestamps.
4. **Pick moments + an AI title** — `identify_moments()` sends the transcript
   to the selected LLM provider (`llm_providers.py`) using the prompt for the
   requested `clip_mode` (see `CLIP_MODE_PROMPTS` — one prompt per mode, each
   asking for `[{"start", "end", "title", "viral_score", "hook"}, ...]` on exact
   transcript sentence boundaries — same call, no extra API cost), then
   repairs/validates the JSON. Moments are ranked by `viral_score` and the
   strongest kept. On a parse/API failure a chunk retries on a resident Hugging
   Face model (Qwen2.5-7B), then deterministic logic.
5. **Render each moment**, one of two paths, both ending with a thumbnail grab:
   - **Preview mode** (`create_preview_clip()`) — fast: a straight crop/scale
     to 480p, no active-speaker detection, no subtitles.
   - **Full mode** (`process_clip()`) — runs **TalkNet** active-speaker
     detection (`asd/demoTalkNet.py`, `asd/talkNet.py`, `asd/model/`) to find
     and track whoever is talking, then `create_vertical_video()` crops/pans
     the frame to follow them in 9:16, then `create_subtitles_with_ffmpeg()`
     burns in **karaoke-style word-highlighted** captions (the currently-spoken
     word turns a highlight color — the user's own `caption_color` if set, else
     the **Colorist** crew's per-clip emotion-based pick, else brand indigo — no
     drop shadow/black box behind the text) plus a small semi-transparent
     `ClipCast` watermark.
   - Both paths call `create_thumbnail()` afterward — one ffmpeg frame grab
     from the *final* rendered video (captions/watermark included), ~15% into
     the clip.
6. **Upload** — each rendered clip *and* its thumbnail JPEG are pushed back to
   S3 under the source's key prefix; temporary container files are cleaned up
   (`temporary_workdir()`). The endpoint returns a structured
   `{s3_key, thumbnail_s3_key, title, duration}` record per clip (not just
   aggregate counts) so the frontend can create `Clip` rows directly.

## The `ClipCast` class

`@app.cls(gpu="L40S", cpu=4.0, memory=16384, timeout=14400, max_containers=2, ...)`
— `main.py` (4h timeout so a multi-hour source has real headroom). Modal keeps
the loaded models (WhisperX + alignment model) resident across requests to the
same warm container via `@modal.enter()`'s `load_model()`, so only a cold start
pays the multi-GB model download/load cost.

| Method | Purpose |
|---|---|
| `load_model()` (`@modal.enter`) | Runs once per container: loads WhisperX + alignment models onto the GPU, patches a `faster_whisper` compatibility issue, prepares the LLM provider clients |
| `transcribe_video()` (`@modal.method`) | ffmpeg → WhisperX → word-level segments |
| `identify_moments()` (`@modal.method`) | Transcript → selected LLM (HF/deterministic fallback) → validated, viral-ranked list of `{start, end, title, viral_score, hook}` moments |
| `plan_clip_presentation()` (`clip_crew.py`) | The Colorist crew picks the caption highlight color per clip; decisions recorded to the job's `production_log` |
| `create_thumbnail()` | ffmpeg single-frame grab from the final rendered clip |
| `process_video()` (`@modal.fastapi_endpoint`) | The public endpoint — orchestrates steps 1–6 above, translates failures into meaningful HTTP status codes (`404` missing S3 source, `422` corrupt/unreadable video, `502`/`503` upstream failures) |

## Deploy

```bash
./deploy.sh                            # from this directory
# or
../../deploy.sh processor              # from clipcast-backend/
```

Required secret values (pushed via `../../scripts/setup_modal_secret.py`):
`PROCESS_VIDEO_ENDPOINT_AUTH`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`,
`AWS_REGION`, `S3_BUCKET_NAME`, and at least one LLM provider key
(`DEEPSEEK_API_KEY` default, `GEMINI_API_KEY`, or `ANTHROPIC_API_KEY`). Optional:
the Langfuse trace keys (docs/18).

## Gotchas

- This app never talks to the Postgres database — it's a pure video-in,
  clips-out worker. Job status, clip DB rows, and credit deduction are all the
  frontend's responsibility (`processVideoFn` in
  `clipcast-frontend/src/inngest/functions.ts`), done once this endpoint
  returns.
- A cold GPU start can take a few minutes before the first request returns;
  warm containers (kept alive by `scaledown_window=120`) are much faster.
- `retries=0` is intentional — a partially-completed video render should not
  be silently retried by Modal; the frontend owns retry/cancel UX.
