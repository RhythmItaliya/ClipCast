# ClipCast

AI podcast clipper. Upload a long-form video (or paste a YouTube URL) and get
back short vertical clips — auto-transcribed, auto-selected by an LLM, captioned,
and reframed to 9:16.

Two parts, two repos:

| Part | What | README |
|---|---|---|
| `clipcast-frontend/` | Next.js web app — auth, billing, upload, admin panel | [clipcast-frontend/README.md](clipcast-frontend/README.md) |
| `clipcast-backend/` | Modal/Python GPU pipeline — download, transcribe, clip | [clipcast-backend/README.md](clipcast-backend/README.md) |

## Run it

```bash
cp .env.example .env   # fill in real values — see docs/01-environment-and-accounts.md
./start.sh             # frontend + Inngest worker + Stripe webhook listener
```

| Service | Port |
|---|---|
| Frontend (Next.js) | http://localhost:3000 |
| Inngest dev dashboard | http://localhost:8288 |
| Backend (Modal) | cloud-only — never runs on your machine |

## Build guide

Never seen this codebase before? [`docs/`](docs/) is a staged, numbered
walkthrough of the whole system — start at
[`docs/00-overview.md`](docs/00-overview.md).

Visual diagrams (system design, pipeline, credits/billing, video processing,
YouTube ingestion) live in [`docs/excalidraw/`](docs/excalidraw/).
