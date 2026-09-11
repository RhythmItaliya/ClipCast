# ClipCast E2E Test Harness

Two complementary harnesses live here:

- **`page_smoke.py`** — app-side. Logs in as the seeded admin in a real browser
  (Playwright) and visits **every** route, failing on any 500 / error boundary.
  Fast, free, no Modal. See **Page smoke test** below.
- **`e2e_full_pipeline.py`** — backend-side. Drives the real Modal pipeline
  (download → processor → clips → audio). Real GPU + money.

---

## Page smoke test (`page_smoke.py`)

The complement to `e2e_full_pipeline.py`: that harness only exercises the Modal
backend, so a Next.js page that 500s renders nothing to it. `page_smoke.py`
covers that gap — it logs in as the seeded **admin** and asserts every app route
renders (no 5xx, no `error.tsx` boundary).

> Born from a real bug: `/admin` was throwing a 500 because `DATABASE_URL` had
> `connection_limit=1`, so the admin overview's `Promise.all` fan-out of 6+
> server-component queries exhausted the single pooled connection and tripped
> `pool_timeout`. Nothing tested page rendering, so nothing caught it. This does.

```bash
# Prereqs: dev server up (npm run dev) + DB seeded (npx tsx prisma/seed.ts)
python3 testing/page_smoke.py            # headless, localhost:3000
python3 testing/page_smoke.py --headed   # watch it
python3 testing/page_smoke.py --shots    # screenshot every page (else just /admin)
```

Covers all static routes plus the query-heavy dynamic `[id]` pages (first row of
`/admin/jobs`, `/admin/users`, `/dashboard/production`; skipped, not failed, when
a table is empty). Writes `testing/reports/smoke-<ts>/report.json` and a
full-page `/admin` screenshot. Exit `0` only if every route passed. Uses
`ADMIN_EMAIL` / `ADMIN_PASSWORD` from `.env` (defaults match the seed:
`admin@clipcast.local` / `Admin@1234`). Playwright is already installed; if the
`playwright` import fails, run it with `/usr/bin/python3`.

---

## Backend pipeline harness (`e2e_full_pipeline.py`)

`e2e_full_pipeline.py` drives the **real** ClipCast pipeline end-to-end against
the deployed Modal endpoints, and writes a machine-readable + human-readable
report. It has two independent flows:

- **Clip flow** (default): YouTube URL → local yt-dlp download → S3 → processor
  → 9:16 captioned clips in S3.
- **Audio flow** (`--audio` / `--audio-only`): a prompt-based Audio Studio
  *generate* job on the mixer endpoint.

> ⚠️ **Real runs cost money and GPU time and hit real Modal.** Keep to short
> source videos. There is a **2-job active-concurrency limit** per user, so a
> single clip run + a single audio run is fine, but don't fan out many at once.
> `--help` and importing the module do **not** run anything.

## Why it downloads *locally*

The clip flow calls the dev server's **`/api/local-download`** route (local
`yt-dlp`, uploads the source to S3) instead of the cloud downloader. Local runs
from a home/residential IP, which dodges the YouTube datacenter-IP blocking that
the cloud proxy path currently hits. This mirrors the app's own TEMP local
fallback (`inngest/functions.ts` → `postLocalDownload`).

## Prerequisites

1. **Dev server running** (serves `/api/local-download`):
   ```bash
   cd clipcast-frontend
   npm run dev            # http://localhost:3000
   npm run inngest-dev    # only needed to exercise the app's own queue; the
                          # harness talks to Modal directly and does not need it
   ```
   `yt-dlp` must be installed on PATH (or `YT_DLP_PATH` set); a JS runtime
   (`deno`/`node`/`bun`) and optionally `YT_DLP_COOKIES` improve success/quality.
2. **Backend deployed** to Modal (composer first):
   ```bash
   ./clipcast-backend/deploy.sh all
   ```
3. **DB seeded** (`prisma/seed.ts`, via `npm run db:push` then the seed) so the
   app has the test accounts and the active LLM provider configured.
4. **Repo-root `.env`** filled in. The harness parses it itself (no deps needed).
   Optional: `pip install boto3` for presigned preview URLs.

### Seeded accounts

| Role  | Email                  | Password     | Notes             |
| ----- | ---------------------- | ------------ | ----------------- |
| ADMIN | `admin@clipcast.local` | `Admin@1234` |                   |
| USER  | `client@clipcast.local`| `Client@1234`| 1000 credits      |

The harness calls Modal **directly** (bypassing app auth/credits), so it does
not log in — the accounts matter for exercising the same jobs through the UI.

## Environment variables

| Var | Used for | Required |
| --- | --- | --- |
| `LOCAL_DOWNLOAD_ENDPOINT` | local yt-dlp route (default `http://localhost:3000/api/local-download`) | no (defaulted) |
| `PROCESS_VIDEO_ENDPOINT` | processor / clip endpoint | clip flow |
| `PROCESS_AUDIO_ENDPOINT` | mixer / Audio Studio endpoint | `--audio` |
| `PROCESS_VIDEO_ENDPOINT_AUTH` | shared bearer for processor + mixer | yes |
| `S3_BUCKET_NAME`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | S3 (presigned URLs only) | presign only |
| `CLIPCAST_LLM_PROVIDER` | default `--llm-provider` | no |
| `CLIPCAST_LLM_MODEL` / `CLIPCAST_LLM_EFFORT` / `CLIPCAST_LLM_BASE_URL` | per-job LLM overrides | no |
| `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` / `DEEPSEEK_API_KEY` / `OPENAI_API_KEY` | forwarded as `llm_api_key` for the chosen provider | no |

**LLM note:** the production per-job LLM config (Opus 4.8 via a gateway) is
stored **encrypted in the DB** and injected by the app at dispatch. This harness
talks to Modal directly and can't read that, so it forwards only what's in the
environment; any `llm_*` field left null makes the backend fall back to its own
Modal-secret default (a valid, working path — the AI crew degrades gracefully).
To reproduce the exact gateway setup, set `CLIPCAST_LLM_MODEL=claude-opus-4-8`,
`CLIPCAST_LLM_EFFORT=medium`, `CLIPCAST_LLM_BASE_URL=<gateway>` and the key env.

## Example commands

```bash
# Fast preview clip run — cheapest smoke test (skips ASD + captions)
python3 testing/e2e_full_pipeline.py --preview

# Full run, exhaustive "all" fan-out (default mode), custom URL
python3 testing/e2e_full_pipeline.py --url "https://www.youtube.com/watch?v=arj7oStGLkU" --mode all

# One targeted mode
python3 testing/e2e_full_pipeline.py --mode highlights

# Reuse an already-downloaded S3 source (skip the local download)
python3 testing/e2e_full_pipeline.py --s3-key "test-e2e/<uuid>/original.mp4" --mode qa

# Clip run + an Audio Studio generate job
python3 testing/e2e_full_pipeline.py --preview --audio

# Audio Studio only
python3 testing/e2e_full_pipeline.py --audio-only \
    --audio-prompt "warm lofi hip hop, jazzy keys, relaxed"

# See every flag
python3 testing/e2e_full_pipeline.py --help
```

Flags: `--url`, `--mode {qa,educational,motivational,highlights,any,all}`,
`--preview`, `--audio`, `--audio-only`, `--audio-prompt`, `--llm-provider`,
`--s3-key`, `--timeout` (per-stage seconds, default 2700), `--no-presign`.

## What each stage verifies

| Stage | Verifies | Pass/fail |
| --- | --- | --- |
| **Configuration** | required env vars present; endpoints resolved | fail if a required var is missing |
| **Local download** | `/api/local-download` returns `status:"completed"` + an S3 key | fail on non-200 / unreachable dev server |
| **Processor** | processor returns HTTP 200 with a result body | fail on non-200 / auth / timeout |
| **Verify clips** | **clip count > 0**; each clip's duration vs the 30-60s target; captions burned | **fail** on 0 clips or missing captions (non-preview); duration outside 30-60s is a **warning** (backend allows 15-120s) |
| **Audio generate** | mixer submit → 202 + `call_id`, poll to 200, result has an `s3_key` artifact (+ presigned URL) | fail on submit/poll error or missing `s3_key` |

**Captions check is indirect:** the processor's full path writes `clip_<i>.mp4`
*after* burning captions, while `--preview` writes `preview_<i>.mp4` and skips
them. The harness uses that render-path filename as the caption signal (the
response carries no explicit captions flag; a byte-accurate check would need to
download + OCR a frame, which is intentionally out of scope).

## Output

Every run writes:

- `testing/reports/e2e-<UTC-timestamp>/report.json` — machine-readable: stages,
  timings, pass/fail, errors, the LLM provider/model used, and the clip list
  with durations + (optional) presigned URLs.
- `testing/TEST_REPORT.md` — human-readable summary of the **latest** run:
  status table per stage, environment, clip results, audio artifact, and any
  anomalies flagged.

Exit code is `0` only if every executed stage passed, else `1`.
