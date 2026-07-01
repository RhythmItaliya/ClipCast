# ClipCast backend (Modal)

GPU video-processing worker: S3 (or YouTube) download → WhisperX transcription →
Gemini moment selection → TalkNet active-speaker vertical crop → subtitled clip
render → S3 upload. All heavy compute runs on **Modal**, never locally.

## Layout

```
clipcast-backend/
├── pipeline/                 the deployed Modal app — DEPLOY FROM HERE
│   ├── main.py               Modal entrypoint: FastAPI endpoint + pipeline
│   ├── asd/                  TalkNet active-speaker detection (vendored, inference-only)
│   └── requirements.txt      image dependencies
├── scripts/
│   └── setup_modal_secret.py push .env values into the Modal Secret
└── .venv/ , venv/            local virtualenvs (gitignored)
```

> **Why `requirements.txt` and `asd/` live inside `pipeline/`:** Modal resolves
> `pip_install_from_requirements("requirements.txt")` and
> `add_local_dir("asd", ...)` relative to the directory you run `modal deploy`
> from. Keeping them beside `main.py` and deploying from `pipeline/` keeps those
> relative paths valid.

## Deploy

```bash
cd clipcast-backend
python -m venv .venv && source .venv/bin/activate
pip install -r pipeline/requirements.txt

# One-time (or whenever .env changes): create/update the Modal secret
python scripts/setup_modal_secret.py

# Deploy / redeploy
cd pipeline && modal deploy main.py
```

## Input paths

- **File upload (primary):** the frontend uploads the source video to S3; Modal
  downloads it from S3 and processes it. Reliable and fully cloud.
- **YouTube URL:** a CPU-only Modal function downloads up to 4K via `yt-dlp`
  (with Deno's n-challenge solver), remuxes without re-encoding, and uploads
  directly to S3. The L40S starts only after this succeeds. YouTube blocks
  datacenter IPs, so a **residential** `YT_DLP_PROXY` is required.

## Secret keys (`clipcast-secret`)

`GEMINI_API_KEY`, `PROCESS_VIDEO_ENDPOINT_AUTH`, `AWS_ACCESS_KEY_ID`,
`AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `S3_BUCKET_NAME`, and optionally
`YT_DLP_PROXY` (required for the YouTube-URL path).
