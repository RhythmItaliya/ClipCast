# ClipCast

ClipCast is an AI podcast clipper. Upload a long-form video, or just paste a
YouTube link, and it hands back a set of short vertical clips — automatically
transcribed, automatically selected by an LLM, captioned, and reframed to
9:16 — ready to post as Shorts, Reels, or TikToks.

The project is split into two halves:

- **The web app** — the Next.js frontend, in the `clipcast-frontend` folder.
  It handles sign-in, billing, uploads, and the admin panel. See
  [clipcast-frontend/README.md](clipcast-frontend/README.md).
- **The processing backend** — a Python service that runs on Modal's cloud
  GPUs, in the `clipcast-backend` folder. It downloads the video, transcribes
  it, picks the best moments, and renders the final clips. See
  [clipcast-backend/README.md](clipcast-backend/README.md).

## Getting started

1. Install the frontend's dependencies:
   ```bash
   cd clipcast-frontend && npm install && cd ..
   ```
2. Install the backend helper scripts' dependencies (only needed if you'll
   run the backend's setup/test scripts yourself):
   ```bash
   pip install -r clipcast-backend/requirements.txt
   ```
3. Copy the environment template and fill in real values — see
   [docs/01-environment-and-accounts.md](docs/01-environment-and-accounts.md)
   for what every value is and where to get it:
   ```bash
   cp .env.example .env
   ```
4. Start everything that's meant to run on your machine:
   ```bash
   ./start.sh
   ```

`start.sh` launches the frontend and its background job worker together — it
never runs the video-processing backend locally (that always runs on Modal's
cloud, even in development).

| Service | Address |
|---|---|
| The web app | http://localhost:3000 |
| Background job dashboard (Inngest) | http://localhost:8288 |
| Video processing backend | runs on Modal's cloud, not on your machine |

## Learn how it all works

Never seen this codebase before? [docs/](docs/) is a staged, numbered
walkthrough of the whole system, written to be read start to finish — begin
at [docs/00-overview.md](docs/00-overview.md).

Prefer pictures? [docs/excalidraw/](docs/excalidraw/) has one diagram per
major flow — the overall system design, the processing pipeline, credits and
billing, video processing, and YouTube ingestion.
