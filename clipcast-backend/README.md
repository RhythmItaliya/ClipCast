# ClipCast Modal backend

ClipCast uses four independently deployed [Modal](https://modal.com) apps. Local
development runs only Next.js and Inngest; video downloads and GPU processing
stay in the cloud — nothing here runs on your machine.

## Services

```
clipcast-backend/
├── apps/
│   ├── processor/             clipcast (L40S GPU) — see apps/processor/README.md
│   │   ├── main.py            transcribe · moment pick · reframe · captions
│   │   ├── clip_crew.py       the Colorist crew (docs/17)
│   │   ├── crew.py            vendored copy of ../../crew/agents.py
│   │   ├── llm_providers.py   DeepSeek / Gemini / Claude adapters
│   │   ├── requirements.txt
│   │   ├── asd/               TalkNet active-speaker detection
│   │   └── deploy.sh
│   ├── downloader/            clipcast-downloader (CPU) — see apps/downloader/README.md
│   │   ├── main.py
│   │   └── deploy.sh
│   ├── mixer/                 clipcast-mixer (L40S GPU) — see apps/mixer/README.md
│   │   ├── main.py            Audio Studio: mashup + AI arrangement (docs/14–16)
│   │   ├── audio_engine.py    deterministic DSP (beat/key match, transitions)
│   │   ├── music_crew.py      the music production crew (docs/17)
│   │   ├── research.py        Song Research / A&R step (docs/19)
│   │   ├── crew.py            vendored copy of ../../crew/agents.py
│   │   └── deploy.sh
│   └── composer/              clipcast-composer (L4 GPU) — ACE-Step music gen
│       ├── main.py
│       └── deploy.sh
├── crew/                      shared multi-agent framework (docs/17), CPU-tested
├── scripts/
│   ├── setup_modal_secret.py  push .env values into Modal secret
│   └── test_pipeline.py       end-to-end pipeline test
└── deploy.sh                  deploy one service or all
```

- **[apps/downloader](apps/downloader/README.md)** — receives a YouTube URL,
  downloads it through rotating free proxies (or a residential proxy), uploads
  the source to S3.
- **[apps/processor](apps/processor/README.md)** — the GPU worker: transcribes,
  picks clip-worthy moments with the selected LLM, reframes to 9:16 with
  active-speaker tracking, burns in captions, uploads clips to S3.
- **[apps/mixer](apps/mixer/README.md)** — the Audio Studio GPU worker: runs
  Song Research, the music crew, stem/beat/key mixing, and the Audiobox-scored
  redo loop; calls the composer for the instrumental bed.
- **apps/composer** — the ACE-Step (3.5B) text-to-music model, called by the
  mixer by name (`modal.Cls.from_name`), so it is deployed first.

The `crew/` package is the framework the music crew and clip crew are built on;
a synced copy is vendored into each app's image as `crew.py` so the Modal build
doesn't need the repo root on its path.

The app names (`clipcast`, `clipcast-downloader`, `clipcast-mixer`,
`clipcast-composer`) are intentionally stable so redeployment updates the
existing Modal apps and preserves the frontend endpoint URLs.

## Deployment

```bash
# All four services (composer first — the mixer calls it by name)
./clipcast-backend/deploy.sh all

# One service only
./clipcast-backend/deploy.sh processor
./clipcast-backend/deploy.sh downloader
./clipcast-backend/deploy.sh mixer
./clipcast-backend/deploy.sh composer
```

Each service can also be deployed from its own directory:

```bash
./clipcast-backend/apps/processor/deploy.sh
./clipcast-backend/apps/downloader/deploy.sh
./clipcast-backend/apps/mixer/deploy.sh
./clipcast-backend/apps/composer/deploy.sh
```

Before the first deployment, set up a local virtualenv with the helper-script
dependencies, then copy the required values from the root `.env` to the
shared Modal secret:

```bash
python -m venv clipcast-backend/.venv
source clipcast-backend/.venv/bin/activate
pip install -r clipcast-backend/requirements.txt
modal token new    # one-time Modal CLI login

python clipcast-backend/scripts/setup_modal_secret.py
```

Required secret values are `PROCESS_VIDEO_ENDPOINT_AUTH`, `AWS_ACCESS_KEY_ID`,
`AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, and `S3_BUCKET_NAME`, plus at least one
LLM provider key — `DEEPSEEK_API_KEY` (the default provider), `GEMINI_API_KEY`,
or `ANTHROPIC_API_KEY`. Optional: `YT_DLP_PROXY` (a reliable residential proxy is
recommended for YouTube) and the Langfuse trace keys (`LANGFUSE_PUBLIC_KEY`,
`LANGFUSE_SECRET_KEY`, `LANGFUSE_HOST`) for agent monitoring (docs/18).
`setup_modal_secret.py` pushes whichever of these are set in the root `.env`.

## Data flow

Clip jobs (the video pipeline):

1. `clipcast-downloader` receives a YouTube URL, downloads remotely, and uploads
   the original source directly to S3. (Direct uploads skip this step.)
2. `clipcast` downloads the S3 object inside Modal, transcribes and renders on
   an L40S GPU, uploads the clips to S3, and removes temporary container files.
3. The user's computer only runs the frontend and local event orchestration.

Audio Studio jobs (docs/14–16) run the same way on `clipcast-mixer`, which calls
`clipcast-composer` for the AI instrumental bed and writes the finished MP3/WAV
master back to S3.

---

## End-to-end pipeline test

`scripts/test_pipeline.py` runs the full pipeline against your live Modal
endpoints: YouTube URL → CPU downloader → S3 → GPU processor → S3 clips.

### Prerequisites

```bash
# Activate a Python virtualenv that has the dependencies:
source clipcast-backend/venv/bin/activate     # or .venv/bin/activate
pip install -r clipcast-backend/requirements.txt
```

The script reads credentials from the repo root `.env` automatically.
All required environment variables must be set:

| Variable | What it is |
|---|---|
| `PROCESS_VIDEO_ENDPOINT` | Modal GPU processor URL |
| `DOWNLOAD_VIDEO_ENDPOINT` | Modal CPU downloader URL |
| `PROCESS_VIDEO_ENDPOINT_AUTH` | Shared bearer token |
| `S3_BUCKET_NAME` | S3 bucket name |
| `AWS_REGION` | S3 region (e.g. `us-east-1`) |
| `AWS_ACCESS_KEY_ID` | AWS access key |
| `AWS_SECRET_ACCESS_KEY` | AWS secret key |

### Quick test (default short video, ~3 min)

```bash
# From repo root — fastest: preview mode skips ASD + subtitles (~5-10 min total)
python clipcast-backend/scripts/test_pipeline.py --preview

# Full quality clips (takes 15-25 min with cold GPU start)
python clipcast-backend/scripts/test_pipeline.py
```

### Custom video

```bash
python clipcast-backend/scripts/test_pipeline.py \
  --url "https://www.youtube.com/watch?v=<short_video_id>" \
  --mode highlights \
  --preview
```

### Skip download (already in S3)

```bash
python clipcast-backend/scripts/test_pipeline.py \
  --s3-key "test-e2e/abc123/original.mp4" \
  --mode qa
```

### All options

```
--url URL           YouTube URL (default: TED-Ed ~3 min short)
--s3-key KEY        Skip download; use existing S3 key for processing
--mode MODE         Clip mode: qa | motivational | educational | highlights | all
--preview           Fast preview clips only (no ASD, no subtitles, 480p)
--skip-process      Only test the download step, skip GPU processing
--no-presign        Do not generate presigned S3 URLs for clip preview
```

### What the test verifies

1. All required env vars are present and non-empty
2. Download endpoint accepts the YouTube URL and returns a `call_id`
3. Download worker completes and the video lands in S3
4. GPU processor transcribes, identifies moments, and renders clips
5. The rendered clips appear in S3 under the expected prefix
6. Presigned 1-hour URLs are printed so you can preview them in a browser

### Recommended short test videos (≤ 5 min, low bot-block risk)

| URL | Duration | Description |
|---|---|---|
| `https://www.youtube.com/watch?v=arj7oStGLkU` | 3:19 | TED-Ed — educational (default) |
| `https://www.youtube.com/watch?v=H14bBuluwB8` | 2:48 | Short motivational talk |
| `https://www.youtube.com/watch?v=JC82Il2cjqA` | 4:05 | Short podcast-style clip |

### Troubleshooting

**Download fails with "all proxies blocked"**

The free proxy list needs to be seeded. Run once after first deploy:
```bash
modal run clipcast-backend/apps/downloader/main.py::refresh_proxies
```
Or set `YT_DLP_PROXY` to a residential proxy URL in `.env` and redeploy.

**Processing times out**

- Use `--preview` for a much faster test run (skips ASD + subtitle burn-in)
- A GPU cold-start can take 5 minutes; warm containers finish in 2-5 min

**"S3 key not found" error in processor**

The download step must complete before processing starts. Check the S3 key
printed by the download step exists in your bucket.

**"LLM API error" / provider unreachable**

The pipeline degrades to deterministic fallbacks when no provider is reachable,
so this is non-fatal — but to fix it, re-run `setup_modal_secret.py` to push the
latest provider key (`DEEPSEEK_API_KEY`, `GEMINI_API_KEY`, or `ANTHROPIC_API_KEY`),
then redeploy the affected app.
