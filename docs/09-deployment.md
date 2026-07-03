# ClipCast — 09 — Deployment

## Backend (Modal)

One shared secret, two independently deployable apps.

```bash
# 1. Push the required env values into the Modal secret "clipcast-secret"
python clipcast-backend/scripts/setup_modal_secret.py
# --force to overwrite an existing secret

# 2. Deploy
clipcast-backend/deploy.sh all          # both apps
clipcast-backend/deploy.sh processor    # just the GPU worker
clipcast-backend/deploy.sh downloader   # just the YouTube downloader
```

`setup_modal_secret.py` reads the repo-root `.env` directly (Modal containers
can't see your local `.env`, so values have to be pushed in explicitly) and
only forwards the keys the deployed code actually reads:
`GEMINI_API_KEY`, `PROCESS_VIDEO_ENDPOINT_AUTH`, `AWS_ACCESS_KEY_ID`,
`AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `S3_BUCKET_NAME` (required),
`YT_DLP_PROXY` (optional).

Each `modal deploy` prints a public HTTPS endpoint URL — paste
the processor's into `PROCESS_VIDEO_ENDPOINT` and the downloader's into
`DOWNLOAD_VIDEO_ENDPOINT` in `.env`. The Modal **app names are stable**
(`clipcast`, `clipcast-downloader`), so redeploying updates the existing app in
place rather than minting a new URL — you don't need to update these env vars
again on future deploys, only on first setup.

Redeploy either app independently any time its code changes:
`clipcast-backend/apps/processor/deploy.sh` or
`clipcast-backend/apps/downloader/deploy.sh` directly.

### What the deploy scripts actually do

`clipcast-backend/scripts/setup_modal_secret.py` — reads `.env`, checks the
required keys are present, then shells out to the Modal CLI:

```python
env = dotenv_values(ENV_PATH)     # repo-root .env
missing = [k for k in REQUIRED_KEYS if not env.get(k)]
if missing:
    print(f"ERROR: missing/empty: {', '.join(missing)}"); return 1

pairs = {k: env[k] for k in REQUIRED_KEYS}
pairs |= {k: env[k] for k in OPTIONAL_KEYS if env.get(k)}

cmd = ["modal", "secret", "create", "clipcast-secret", "--force"] + [f"{k}={v}" for k, v in pairs.items()]
subprocess.run(cmd)
```

Each app's own `deploy.sh` (e.g. `apps/processor/deploy.sh`) is a thin wrapper
that just `cd`s into the app directory and calls the Modal CLI:

```bash
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"
modal deploy main.py
```

`clipcast-backend/deploy.sh` (the top-level one) just dispatches to
`apps/processor/deploy.sh` and/or `apps/downloader/deploy.sh` based on its
`all`/`processor`/`downloader` argument.

## Frontend

Any Node host that can run `next build`/`next start` works (Vercel, a VPS,
etc.). Two things matter regardless of host:

1. **Env vars** — same `.env` contents as local dev, provided however your
   host expects (Vercel project env vars, a `.env` on a VPS, etc.). `BASE_URL`
   must match the real deployed URL (it's used to build the Google OAuth
   redirect URI and Stripe's checkout success URL).
2. **`npm run build`** runs `prisma db push && next build` — the schema is
   pushed to the production database as part of every build. For a stricter
   production rollout with migration history instead, use
   `npx prisma migrate deploy` (there's an `npm run db:migrate` script for
   this) and drop `db push` from the build step.

Point the deployed frontend's Stripe webhook endpoint
(`https://your-domain/api/stripe/webhook`) at a **live** webhook in the Stripe
dashboard (not the CLI's `stripe listen`, which is local-dev only) and put its
signing secret in `STRIPE_WEBHOOK_SECRET`. Similarly, Inngest needs real
`INNGEST_EVENT_KEY`/`INNGEST_SIGNING_KEY` values from the Inngest Cloud
dashboard in production (`"local"`/`"local"` only works against the local dev
worker).

## Local dev orchestration

`./start.sh` from the repo root starts everything that's supposed to run
locally — and only that:

- Next.js dev server → `:3000`
- Inngest dev worker → `:8288`
- Stripe webhook listener (only if the `stripe` CLI is installed and logged
  in)

It refuses to start if `.env` is missing, if Node < 20.9 (auto-switches to
`nvm`'s Node 22 if available), or if ports 3000/8288 are already bound
(prevents stacking duplicate dev servers after a terminal was closed
uncleanly). `./start.sh --deploy` redeploys the Modal backend first, then
starts the local stack.

`start.sh` also attempts a "clear stuck local jobs" step
(`npx tsx prisma/reset-stuck-jobs.ts || true`) before starting the servers —
**that script doesn't currently exist** in `clipcast-frontend/prisma/`, so this
step silently no-ops (the `|| true` swallows the failure). Leftover
`queued`/`processing` `UploadedFile` rows from an ungraceful shutdown are
instead cleared via the admin panel's "Reset All Stuck" button
(`/admin/jobs`, see [08-admin-panel.md](08-admin-panel.md)) or the existing
`/api/reset-stuck-jobs` route.

**Nothing GPU/network-heavy ever runs locally** — that's the entire point of
the Modal split (see [06-video-processing-pipeline.md](06-video-processing-pipeline.md)).
Every video-processing test, even in local development, hits the real deployed
Modal endpoints.
