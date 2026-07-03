"""CPU-only Modal YouTube downloader -> S3.

Proxy strategy (bypasses YouTube's datacenter-IP blocking):
  1. If YT_DLP_PROXY is set (paid residential proxy), use it directly.
  2. Otherwise use free proxies via https://github.com/Petrprogs/yt-dlp-proxy:
     its `update` command scrapes providers, speed-tests candidates and writes
     the 5 fastest to proxy.json. Speed-testing hundreds of free proxies takes
     10-20 minutes, so it runs OUT of the request path: a scheduled Modal
     function refreshes proxy.json into a persisted Volume every 15 minutes and
     the endpoint just reads the latest ranked list. We then try each ranked
     proxy in order with yt-dlp, re-using the tool's own failure markers to
     decide when to rotate. (We do not use its run wrapper: it shell-joins argv
     unquoted, which breaks on URLs containing `&`, and it retries forever —
     unsafe in a server.)

Prime the volume once after the first deploy:
    modal run apps/downloader/main.py::refresh_proxies
"""

import json
import os
import pathlib
import shutil
import subprocess
import sys
import time
import uuid

import boto3
import modal
from fastapi import Depends, HTTPException, status
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel


class DownloadVideoRequest(BaseModel):
    youtube_url: str | None = None
    s3_key: str | None = None
    call_id: str | None = None


PROXY_TOOL_DIR = "/opt/yt-dlp-proxy"
# main.py writes proxy.json to the PARENT of its own directory.
LOCAL_PROXY_JSON = pathlib.Path("/opt/proxy.json")
# Shared, persisted copy the endpoint reads (refreshed on a schedule).
VOLUME_MOUNT = pathlib.Path("/proxies")
SHARED_PROXY_JSON = VOLUME_MOUNT / "proxy.json"
PROXY_MAX_AGE_SECONDS = 60 * 60  # schedule refreshes every 15 min
# A multi-hour source video is a multi-GB file through a rotating free
# proxy; 1500s (25 min) was only enough for shorter videos. Raised to 1
# hour, with the Modal function timeout below and the Inngest poll cap
# (MAX_POLL_ATTEMPTS in src/inngest/functions.ts) raised to match.
OVERALL_DEADLINE_SECONDS = 3600

# Same markers yt-dlp-proxy uses to decide a proxy is burnt (execute_yt_dlp_command),
# plus common transport failures.
PROXY_FAILURE_MARKERS = (
    "Sign in to",
    "403",
    "video is available in",
    "Unable to connect to proxy",
    "Connection refused",
    "timed out",
    "Tunnel connection failed",
    "ProxyError",
)

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg", "curl", "unzip", "git")
    .run_commands(
        "curl -fsSL https://deno.land/install.sh | sh",
        "ln -s /root/.deno/bin/deno /usr/local/bin/deno",
        f"git clone --depth 1 https://github.com/Petrprogs/yt-dlp-proxy {PROXY_TOOL_DIR}",
    )
    .pip_install(
        "boto3>=1.34.0",
        "fastapi[standard]>=0.110.0",
        "yt-dlp[default]",
        # yt-dlp-proxy dependencies (see its requirements.txt)
        "requests>=2.32.0",
        "tqdm>=4.67.0",
    )
)

app = modal.App("clipcast-downloader", image=image)
auth_scheme = HTTPBearer()
proxy_volume = modal.Volume.from_name("clipcast-proxies", create_if_missing=True)


def _proxy_string(proxy: dict) -> str:
    """Mirror of yt-dlp-proxy's construct_proxy_string()."""
    protocol = proxy.get("protocol") or "http"
    auth = ""
    if proxy.get("username"):
        auth = f"{proxy['username']}:{proxy['password']}@"
    return f"{protocol}://{auth}{proxy['host']}:{proxy['port']}"


@app.function(
    cpu=4.0,
    memory=2048,
    timeout=1500,
    volumes={str(VOLUME_MOUNT): proxy_volume},
    schedule=modal.Period(minutes=15),
)
def refresh_proxies() -> None:
    """Scheduled: run `yt-dlp-proxy update` and persist proxy.json to the volume."""
    print("Refreshing free proxy list via yt-dlp-proxy update…")
    result = subprocess.run(
        [sys.executable, "main.py", "update", "--max-workers", "64"],
        cwd=PROXY_TOOL_DIR,
        capture_output=True,
        text=True,
        timeout=1380,
    )
    if result.returncode != 0:
        print(f"yt-dlp-proxy update failed: {(result.stderr or result.stdout or '')[-800:]}")
        return
    try:
        proxies = json.loads(LOCAL_PROXY_JSON.read_text())
    except (FileNotFoundError, json.JSONDecodeError, OSError) as err:
        print(f"yt-dlp-proxy update produced no usable proxy.json: {err}")
        return
    if not proxies:
        print("yt-dlp-proxy update found no working proxies; keeping previous list")
        return
    SHARED_PROXY_JSON.write_text(json.dumps(proxies, indent=2))
    proxy_volume.commit()
    print(f"Persisted {len(proxies)} ranked proxies to the volume")


def _load_free_proxies() -> list[str]:
    """Ranked (fastest-first) proxy URLs from the shared proxy.json."""
    try:
        proxy_volume.reload()
        stat = SHARED_PROXY_JSON.stat()
        if time.time() - stat.st_mtime > PROXY_MAX_AGE_SECONDS:
            print("Shared proxy list is stale (>60 min); refresh schedule may be failing")
        proxies = json.loads(SHARED_PROXY_JSON.read_text())
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return []
    ranked = sorted(proxies, key=lambda p: p.get("time", float("inf")))
    urls = []
    for proxy in ranked:
        if proxy.get("host") and proxy.get("port"):
            loc = f"{proxy.get('city', '?')}, {proxy.get('country', '?')}"
            print(f"Candidate proxy: {loc} ({proxy.get('time', '?')}s speed test)")
            urls.append(_proxy_string(proxy))
    return urls


def _run_yt_dlp(url: str, output_template: pathlib.Path, proxy: str, timeout: float):
    command = [
        sys.executable,
        "-m",
        "yt_dlp",
        "--proxy", proxy,
        "--js-runtimes", "deno",
        "--no-playlist",
        "--no-progress",
        "--retries", "4",
        "--fragment-retries", "4",
        "--socket-timeout", "30",
        "--concurrent-fragments", "4",
        "--sleep-requests", "1",
        # Preserve up to 4K. Merging/remuxing does not re-encode.
        "-f", "bv*[height<=2160]+ba/b[height<=2160]/b",
        "--merge-output-format", "mp4",
        "--remux-video", "mp4",
        "-o", str(output_template),
        url,
    ]
    return subprocess.run(command, capture_output=True, text=True, timeout=timeout)


def _finished_files(base_dir: pathlib.Path) -> list[pathlib.Path]:
    return [
        path for path in base_dir.glob("source.*")
        if path.suffix not in {".part", ".ytdl"}
    ]


@app.function(
    cpu=2.0,
    memory=4096,
    # A little above OVERALL_DEADLINE_SECONDS (3600s) so there's headroom to
    # upload the finished file to S3 after the download itself completes.
    timeout=3900,
    retries=1,
    max_containers=4,
    scaledown_window=60,
    secrets=[modal.Secret.from_name("clipcast-secret")],
    volumes={str(VOLUME_MOUNT): proxy_volume},
)
def download_youtube_video_worker(youtube_url: str, s3_key: str):
    base_dir = pathlib.Path("/tmp") / str(uuid.uuid4())
    base_dir.mkdir(parents=True, exist_ok=True)
    output_template = base_dir / "source.%(ext)s"
    deadline = time.monotonic() + OVERALL_DEADLINE_SECONDS

    paid_proxy = os.environ.get("YT_DLP_PROXY", "").strip()

    try:
        if paid_proxy:
            proxies = [paid_proxy]
        else:
            proxies = _load_free_proxies()
            if not proxies:
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail=(
                        "The free-proxy list isn't ready yet (it refreshes every "
                        "15 minutes). Retry in a few minutes, or set YT_DLP_PROXY "
                        "to a residential proxy for reliability."
                    ),
                )

        last_error = "Unknown yt-dlp failure"
        attempt = 0
        while proxies:
            proxy = proxies.pop(0)
            attempt += 1
            remaining = deadline - time.monotonic()
            if remaining < 60:
                last_error = f"Timed out after {attempt - 1} proxy attempts: {last_error}"
                break

            print(f"Attempt {attempt}: downloading via proxy #{attempt}")
            try:
                result = _run_yt_dlp(
                    youtube_url, output_template, proxy, timeout=remaining
                )
            except subprocess.TimeoutExpired:
                last_error = "Download timed out through the proxy."
                break

            if result.returncode == 0 and _finished_files(base_dir):
                break

            output = f"{result.stdout or ''}\n{result.stderr or ''}"
            last_error = (result.stderr or result.stdout or last_error)[-1200:]
            burnt = any(marker in output for marker in PROXY_FAILURE_MARKERS)
            print(
                f"Proxy attempt {attempt} failed "
                f"({'rotating' if burnt else 'error'}): {last_error[-300:]}"
            )
            # Wipe partial fragments so the next proxy starts clean.
            for leftover in base_dir.glob("source.*"):
                leftover.unlink(missing_ok=True)

        candidates = _finished_files(base_dir)
        if not candidates:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"YouTube download failed through proxies: {last_error}",
            )

        source_path = max(candidates, key=lambda path: path.stat().st_size)

        # Validate the file is a real video before uploading to S3
        if source_path.stat().st_size < 1024:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=(
                    "Download produced an empty or near-empty file. "
                    "The video may be restricted, private, or the proxy returned garbage. "
                    f"File size: {source_path.stat().st_size} bytes."
                ),
            )

        probe = subprocess.run(
            [
                "ffprobe", "-v", "error", "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1", str(source_path),
            ],
            capture_output=True,
            text=True,
            timeout=60,
        )
        try:
            duration = float((probe.stdout or "0").strip())
        except ValueError:
            duration = 0.0

        # Log a warning if ffprobe couldn't read the file (may be corrupt)
        if probe.returncode != 0:
            print(
                f"Warning: ffprobe could not read downloaded file "
                f"(returncode={probe.returncode}): {probe.stderr[:200]}"
            )

        try:
            boto3.client("s3").upload_file(
                str(source_path),
                os.environ["S3_BUCKET_NAME"],
                s3_key,
                ExtraArgs={"ContentType": "video/mp4"},
            )
        except Exception as s3_err:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=(
                    f"Downloaded video successfully but S3 upload failed: {str(s3_err)[:400]}. "
                    "Check AWS credentials and S3 bucket permissions."
                ),
            ) from s3_err

        print(f"Uploaded cloud source to S3 key {s3_key} ({source_path.stat().st_size / 1_048_576:.1f} MB)")
        return {
            "success": True,
            "s3_key": s3_key,
            "duration": duration,
            "source_bytes": source_path.stat().st_size,
        }
    finally:
        shutil.rmtree(base_dir, ignore_errors=True)


@app.function(
    cpu=0.25,
    memory=512,
    timeout=60,
    max_containers=10,
    scaledown_window=60,
    secrets=[modal.Secret.from_name("clipcast-secret")],
)
@modal.fastapi_endpoint(method="POST")
def download_youtube_video(
    request: DownloadVideoRequest,
    token: HTTPAuthorizationCredentials = Depends(auth_scheme),
):
    """Submit a download or poll it without holding a long HTTP request."""
    if token.credentials != os.environ["PROCESS_VIDEO_ENDPOINT_AUTH"]:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect bearer token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if request.call_id:
        function_call = modal.FunctionCall.from_id(request.call_id)
        try:
            result = function_call.get(timeout=0)
        except TimeoutError:
            return JSONResponse(
                {"status": "pending", "call_id": request.call_id},
                status_code=status.HTTP_202_ACCEPTED,
            )
        except modal.exception.OutputExpiredError as error:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Download result expired; submit the job again.",
            ) from error
        except Exception as error:
            print(f"Download worker failed for {request.call_id}: {error}")
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Cloud download worker failed: {str(error)[-1000:]}",
            ) from error

        return {"status": "completed", "call_id": request.call_id, **result}

    if not request.youtube_url or not request.s3_key:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="youtube_url and s3_key are required when submitting a job.",
        )

    function_call = download_youtube_video_worker.spawn(
        request.youtube_url, request.s3_key
    )
    return JSONResponse(
        {"status": "accepted", "call_id": function_call.object_id},
        status_code=status.HTTP_202_ACCEPTED,
    )
