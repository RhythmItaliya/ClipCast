# ClipCast

AI-powered podcast video clipper. Upload a long-form podcast video (or paste a
YouTube URL), the backend runs active-speaker detection + transcription +
LLM-driven moment selection, and renders the resulting short-form vertical clips
to S3. Clip selection is driven by a chosen mode — All, Q&A, Educational,
Motivational, or Highlights.

## Architecture

```
┌──────────────────────────┐        ┌──────────────────────────┐
│  clipcast-frontend        │        │  clipcast-backend         │
│  (Next.js 16)             │        │  (Modal/Python)           │
│                           │        │                           │
│  • Auth.js + Discord      │ HTTPS  │  • TalkNet ASD            │
│  • Prisma → Supabase PG   │ ─────▶ │  • WhisperX transcribe    │
│  • Stripe credit packs    │        │  • Gemini moment picker   │
│  • Inngest queue          │        │  • ffmpeg clip render     │
└──────────────────────────┘        └──────────────────────────┘
            │                                   │
            ▼                                   ▼
        AWS S3 ◀─── shared bucket: source uploads + rendered clips ──▶
```

The frontend authenticates the user, takes payment for credits, and either
uploads the source video to S3 or hands a YouTube URL to the backend, then calls
Modal HTTPS endpoints. YouTube links first go to a CPU-only Modal downloader
through a residential proxy and land directly in S3. The L40S worker then reads
the S3 source, processes it, and writes the rendered clips back to S3. Local
development never downloads or processes video.

## Repository layout

```
ClipCast/
├── .env                       ← single source of truth (gitignored)
├── .env.example               template — copy to .env and fill in
├── docs/                      project docs (deployment report, architecture)
├── clipcast-frontend/         Next.js (T3) app — UI, auth, billing
│   ├── src/                    app code (App Router)
│   ├── prisma/                 schema + migrations
│   └── next.config.js          loads ../.env via @next/env
└── clipcast-backend/          Python Modal app — GPU video processing
    ├── pipeline/               the deployed Modal app (deploy from here)
    │   ├── main.py             Modal entrypoint (FastAPI endpoint + pipeline)
    │   ├── asd/                TalkNet active-speaker detection
    │   └── requirements.txt    image dependencies
    ├── scripts/                manual helpers (not part of the deployed image)
    │   ├── setup_modal_secret.py   push .env values into a Modal Secret
    │   └── ytdownload.py           legacy manual YouTube -> S3 downloader
    └── tests/                  local test scaffolding (fake ffmpeg/ffprobe stubs)
```

## Prerequisites

- Node.js 20+ and npm
- Python 3.11+ (for the backend / Modal)
- A [Modal](https://modal.com) account with the CLI authenticated (`modal token new`)
- An AWS account with an S3 bucket
- A Supabase project (Postgres)
- A Stripe account (test mode is fine for development)
- A Discord application for OAuth
- A Google AI Studio API key for Gemini

## Setup

### 1. Configure environment variables

There is **one** environment file for the whole project, at the repo root:
[.env](.env). The frontend's
[next.config.js](clipcast-frontend/next.config.js) loads it via
`@next/env`'s `loadEnvConfig('..')`, and the backend's
[setup_modal_secret.py](clipcast-backend/scripts/setup_modal_secret.py)
reads the same file via `python-dotenv`.

```bash
cp .env.example .env
# then open .env and fill in real values
```

The `.env` file is gitignored. Never commit it. If you ever need to update
the schema (add/remove variables), edit
[src/env.js](clipcast-frontend/src/env.js) so the runtime
validation stays in sync.

### 2. Frontend

```bash
cd clipcast-frontend
npm install
npx prisma db push       # apply schema to your Supabase database
npm run dev              # http://localhost:3000
```

### 3. Backend (Modal)

```bash
cd clipcast-backend
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r pipeline/requirements.txt

# Push your env values into the Modal Secret named "clipcast-secret":
python scripts/setup_modal_secret.py

# Deploy the worker (the pipeline and its deps live together in pipeline/)
cd pipeline && modal deploy main.py
```

`modal deploy` prints the public endpoint URL. Paste that into
`PROCESS_VIDEO_ENDPOINT` in `.env` and choose a value for
`PROCESS_VIDEO_ENDPOINT_AUTH` (the frontend sends it as a bearer token; the
backend checks it).

The deploy also prints `download_youtube_video`. Paste that URL into
`DOWNLOAD_VIDEO_ENDPOINT`. For reliable YouTube links, set `YT_DLP_PROXY` to a
rotating or sticky residential HTTP/SOCKS proxy URL, rerun
`python scripts/setup_modal_secret.py`, and redeploy. Datacenter proxies do not
solve YouTube's cloud-IP blocking.

### 4. Stripe webhook (optional, for credit purchases)

For local development:

```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

Copy the `whsec_…` secret it prints into `STRIPE_WEBHOOK_SECRET`.

## Common scripts

| Where | Command | What it does |
|-------|---------|--------------|
| frontend | `npm run dev` | Next.js dev server with Turbo |
| frontend | `npm run build` | Production build |
| frontend | `npm run check` | Lint + typecheck |
| frontend | `npm run db:studio` | Prisma Studio (DB GUI) |
| frontend | `npm run db:push` | Push schema to Postgres |
| backend  | `cd pipeline && modal deploy main.py` | Deploy/redeploy the worker |
| backend  | `cd pipeline && modal run main.py` | Run a one-off invocation |

## Security

- `.env` is gitignored. `.env.example` is the only env file that should ever
  be committed, and it must contain placeholders only.
- All secrets — AWS keys, Stripe keys, database password, NextAuth secret,
  Modal endpoint token, Gemini key — live in a single `.env`. Rotate them by
  generating new values in their respective consoles and pasting back.
- The Modal endpoint is protected by a shared bearer token
  (`PROCESS_VIDEO_ENDPOINT_AUTH`); rotate it any time the frontend or
  backend is redeployed by an untrusted party.

## License

See [LICENSE.MD](LICENSE.MD).
