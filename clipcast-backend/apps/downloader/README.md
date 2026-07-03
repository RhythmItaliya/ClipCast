# `clipcast-downloader` (Modal app)

CPU-only Modal app that fetches a YouTube video and lands it in S3, so the GPU
processor never has to touch YouTube directly (and never sits idle burning GPU
time on a network-bound download).

## Why it's a separate app from the processor

Downloading is CPU/network-bound and needs YouTube-blocking workarounds
(rotating proxies, retries). Processing is GPU-bound and expensive per second.
Splitting them means the L40S container only spins up once a source file is
already sitting in S3, and the two scale independently.

## YouTube-blocking workaround

YouTube blocks datacenter IPs (which is what every cloud provider's outbound
traffic looks like). Instead of a paid residential proxy, this app rotates
through **free proxies** sourced by
[`yt-dlp-proxy`](https://github.com/Petrprogs/yt-dlp-proxy):

- `refresh_proxies` (`main.py`) is a Modal **scheduled function** (`modal.Period`,
  every 15 minutes) that runs the tool's proxy speed-test (`update`, which takes
  10–20 minutes — this is why it's a background schedule and never runs in the
  request path) and writes the 5 fastest proxies to a Modal Volume
  (`clipcast-proxies`) as `proxy.json`.
- `download_youtube_video_worker` (`main.py`) reads that volume, tries the
  ranked proxies in order, and burns/rotates past any that fail (matching on
  yt-dlp's own failure strings — `"Sign in to"`, `"403"`, `"Unable to connect to
  proxy"`, …) — bounded by a 25-minute deadline.
- `YT_DLP_PROXY` in `.env` is an optional **paid** override (residential proxy
  URL) that skips the free-proxy path entirely when set.

After the volume is first created (or wiped), seed it once:

```bash
modal run clipcast-backend/apps/downloader/main.py::refresh_proxies
```

## Endpoint

`download_youtube_video` — `POST`, `@modal.fastapi_endpoint`, bearer-token
protected by the same `PROCESS_VIDEO_ENDPOINT_AUTH` secret as the processor.

Request body (`DownloadVideoRequest`): `youtube_url`, `s3_key` (where to write
the downloaded file in the shared S3 bucket).

Called from the frontend's Inngest function (`postCloudDownloader()` in
`clipcast-frontend/src/inngest/functions.ts`), which polls Modal's async
call-result endpoint until the download finishes or fails.

## Functions in `main.py`

| Function | Purpose |
|---|---|
| `_load_free_proxies()` | Reads `proxy.json` off the Modal Volume |
| `_proxy_string(proxy)` | Formats a proxy dict into a yt-dlp `--proxy` URL |
| `refresh_proxies()` | Scheduled (15 min): re-runs `yt-dlp-proxy update`, writes the top 5 to the volume |
| `_run_yt_dlp(url, output_template, proxy, timeout)` | Shells out to `yt-dlp` with a given proxy |
| `_finished_files(base_dir)` | Finds the downloaded file yt-dlp produced |
| `download_youtube_video_worker(youtube_url, s3_key)` | Modal function: tries ranked proxies in order, uploads the winner to S3 |
| `download_youtube_video(...)` | The public FastAPI endpoint — validates the bearer token, kicks off the worker |

## Deploy

```bash
./deploy.sh                              # from this directory
# or
../../deploy.sh downloader               # from clipcast-backend/
```

Required secret values (pushed via `../../scripts/setup_modal_secret.py`):
`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `S3_BUCKET_NAME`,
`PROCESS_VIDEO_ENDPOINT_AUTH`. `YT_DLP_PROXY` is optional.

## Gotchas

- Don't put `yt-dlp-proxy update` back in the request path — it takes 10–20
  minutes and will time out the download call.
- Don't use `yt-dlp-proxy`'s own run wrapper — it shell-joins argv unquoted,
  which breaks on YouTube URLs containing `&`, and retries forever on failure.
- Testing Modal endpoints with `curl`: don't combine `-X POST` with `-L`.
  Modal's async result-polling uses a `303` redirect that requires a plain
  `GET`, not a re-sent `POST`.
