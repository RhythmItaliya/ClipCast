# ClipCast — End-to-End Test Report

**Date:** 2026-09-11
**Provider under test:** Anthropic **Claude Opus 4.8** (`claude-opus-4-8`, effort `medium`) via the `use-key.txt` gateway (`https://api-key-gateway.vercel.app/backend/proxy`).
**Source video:** TED — *Inside the Mind of a Master Procrastinator* (Tim Urban), 14m03s.
**Harness:** `testing/e2e_full_pipeline.py` (per-run machine reports in `testing/reports/<ts>/report.json`).

Runs drive the **real** production path: local `yt-dlp` download → S3 → deployed Modal processor / mixer. Real GPU + money.

---

## Overall result

| Area | Result |
| --- | --- |
| Provider wiring (Opus 4.8 via gateway) | ✅ verified (live 200 OK) |
| Seed: admin + client + active provider | ✅ done |
| Local download → S3 | ✅ works (slow, see F2) |
| Clip pipeline (transcribe → moments → ASD 9:16 → **burned captions** → S3) | ✅ works, all clip modes |
| Captions/subtitles burned into every clip | ✅ verified |
| Audio Studio (mixer "generate") | ❌ **broken** — Bug A (torch < 2.6) |
| Test harness correctness | ✅ Bug B found **and fixed** |
| Clip duration quality ("best short") | ⚠️ Finding F1 — clips too short |

---

## What was set up

- **New seed** `prisma/seed.ts`: creates an **ADMIN** (`admin@clipcast.local` / `Admin@1234`) and a **CLIENT** (`client@clipcast.local` / `Client@1234`, 1000 credits), stores the **Claude/Opus 4.8** provider config encrypted (AES-256-GCM, same as the admin panel) from `use-key.txt`, and sets `llm_provider = claude` active. (`prisma/_load-env.ts` loads the repo-root `.env` for standalone tsx scripts.)
- **`use-key.txt` added to `.gitignore`** (it holds a live `sk_live_…` secret).
- **DB data backed up** to `/tmp/clipcast-backup/data-*.json` (7 users, 63 clips, 13 uploads, 5 credit txns) before any reset. `pg_dump` could not be used (server PG 17.6 > local pg_dump 16).
- **Removed** the old `audio-tests/` (41 MB of stale E2E artifacts + a bespoke Modal harness) and the old `testing/` contents (`TESTING_STRATEGY.md`, `TEST_REPORT.md`, `testing/backend/*`); replaced with the single `e2e_full_pipeline.py` harness. Old `testing/` backed up to `/tmp/clipcast-backup/testing-*.tar.gz`.
- Frontend `npm run check` (eslint + tsc): ✅ **exit 0**.

---

## Test runs

| # | Command | Result | Time | Notes |
| --- | --- | --- | --- | --- |
| 1 | `--preview --mode qa` | ✅ PASS | download 19m31s + proc 57s | 6 clips; captions skipped (preview) |
| 2 | `--s3-key … --mode highlights` (full) | ✅ PASS | proc 5m40s | 4 clips, **captions burned**, ASD on |
| 3 | `--s3-key … --mode all --audio` | ⚠️ clips PASS / audio FAIL | proc 11m24s | 10 clips all modes, **captions burned**; audio 502 |
| 4 | `--audio-only` (re-verify harness fix) | ❌ FAIL (correct) | 44s | exit 1, `audio_generate FAIL` recorded |

Clip durations across runs were consistently short: **15–30s** (target 40–60s). Every non-preview clip passed the caption-burn check (`clip_*.mp4` render path). Presigned S3 URLs were playable.

---

## Findings & bugs

### Bug A — Audio Studio worker fails (HTTP 502) — BACKEND, needs redeploy
```
Audio worker failed: Due to a serious vulnerability issue in torch.load, even with
weights_only=True, we now require users to upgrade torch to at least v2.6 ...
(CVE-2025-32434)
```
`torch.load` (via `transformers`/model loading in the mixer→composer generate path) now refuses to run on torch < 2.6 for non-safetensors checkpoints.
- **Cause:** `apps/mixer/requirements.txt` pins `torch==2.4.1`/`torchaudio==2.4.1`; `apps/composer/requirements.txt` pins `torch==2.5.1`. Both < 2.6.
- **Fix (pick one), then `./clipcast-backend/deploy.sh` (composer first):**
  1. Bump `torch`/`torchaudio`(/`torchvision`) to `>=2.6` in **lockstep** in `apps/mixer` and `apps/composer` (verify ACE-Step/Audiobox compatibility), **or**
  2. Pin `transformers` back below the version that added the torch≥2.6 gate (lowest-risk if a bump breaks other pins), **or**
  3. Force `use_safetensors=True` on the offending model load so `torch.load` is never used.
- **Status:** Not fixed here — `modal` CLI is not installed in this environment, so a backend change can't be deployed or verified. Documented for you to apply + redeploy.

### Bug B — Harness falsely reported PASS on an audio failure — FIXED ✅ (verified)
`stage_audio` let a `_poll_audio` exception escape without recording a stage, so a failed audio poll produced **overall PASS / exit 0**. Fixed in `testing/e2e_full_pipeline.py` (wrap `_poll_audio` and record `audio_generate FAIL`). Re-run 4 confirms: overall **FAILED**, exit **1**, stage recorded.

### F1 — Clips are too short for "best short" — BACKEND, needs redeploy
Gemini moment-selection returns ~15–30s spans though the prompt asks for "30–60s / Target 40–60s" (`apps/processor/main.py:73,86,…`); `MIN_CLIP_SECONDS=15` (`main.py:213`) only filters slivers, so short clips ship.
- **Recommended fix:** (a) harden the prompt — make ≥30s a hard rule and instruct the model to widen boundaries to reach 40–60s; and/or (b) add a post-selection pass that extends any sub-30s pick using adjacent transcript sentences before rendering. Requires processor redeploy to take effect.

### F2 — Local download is slow
~19m31s to fetch + upload a 14-min source (yt-dlp on residential IP + 77.8 MB S3 upload). Fine for a fallback, but not a fast path. Consider format-capping or multipart upload if this becomes the primary route.

---

## Not done / still pending

- **From-scratch DB wipe** (`prisma db push --force-reset`): **blocked** — the sandbox safety classifier denies it as a mass-delete. Run it yourself (reseeds after):
  ```
  ! cd clipcast-frontend && npx prisma db push --force-reset --accept-data-loss && npx tsx prisma/seed.ts
  ```
  The seed already ran (upsert) so the accounts + provider exist on the current DB; the pipeline tests above don't depend on a wipe.
- **App-flow / credits UI test** (client logs in → submits a job → credits deducted → queue): not automated (no browser driver installed). Best done manually via the seeded client, or add Playwright.
- **Backend redeploys** for Bug A / F1: can't be applied here (no `modal` CLI).

---

## How to run

Prereqs: dev server up (`npm run dev` — needed for `/api/local-download`), Modal apps deployed, DB seeded (`npx tsx prisma/seed.ts`). Export the gateway config so the crew uses Opus 4.8:
```
export ANTHROPIC_API_KEY="$(grep -iE '^sk' use-key.txt | head -1)"
export CLIPCAST_LLM_MODEL=claude-opus-4-8 CLIPCAST_LLM_EFFORT=medium
export CLIPCAST_LLM_BASE_URL=https://api-key-gateway.vercel.app/backend/proxy

python3 testing/e2e_full_pipeline.py --preview --mode qa      # fast smoke
python3 testing/e2e_full_pipeline.py --mode all              # full, all clip types, captions
python3 testing/e2e_full_pipeline.py --s3-key <key> --mode all --audio   # reuse source + audio
python3 testing/e2e_full_pipeline.py --audio-only            # audio only
```
See `testing/README.md` for details. The 2-job active-concurrency limit applies.
