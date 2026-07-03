# ClipCast Modal backend

ClipCast uses two independently deployed Modal apps. Local development runs only
Next.js and Inngest; video downloads and GPU processing stay in Modal.

## Services

```
clipcast-backend/
├── apps/
│   ├── processor/             clipcast (L40S GPU)
│   │   ├── main.py
│   │   ├── requirements.txt
│   │   ├── asd/
│   │   └── deploy.sh
│   └── downloader/            clipcast-downloader (CPU)
│       ├── main.py
│       └── deploy.sh
├── scripts/
│   └── setup_modal_secret.py
└── deploy.sh                  deploy one service or both
```

The app names are intentionally stable so redeployment updates the existing
Modal apps and preserves the frontend endpoint URLs.

## Deployment

```bash
# Both services
./clipcast-backend/deploy.sh all

# One service only
./clipcast-backend/deploy.sh processor
./clipcast-backend/deploy.sh downloader
```

Each service can also be deployed from its own directory:

```bash
./clipcast-backend/apps/processor/deploy.sh
./clipcast-backend/apps/downloader/deploy.sh
```

Before the first deployment, copy the required values from the root `.env` to
the shared Modal secret:

```bash
./clipcast-backend/.venv/bin/python clipcast-backend/scripts/setup_modal_secret.py
```

Required secret values are `GEMINI_API_KEY`, `PROCESS_VIDEO_ENDPOINT_AUTH`,
`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, and
`S3_BUCKET_NAME`. `YT_DLP_PROXY` is optional but a reliable residential proxy is
recommended for YouTube.

## Data flow

1. `clipcast-downloader` receives a YouTube URL, downloads remotely, and uploads
   the original source directly to S3.
2. `clipcast` downloads the S3 object inside Modal, transcribes and renders on
   an L40S GPU, uploads the clips to S3, and removes temporary container files.
3. The user's computer only runs the frontend and local event orchestration.
