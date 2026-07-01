"""CPU-only Modal YouTube downloader: residential proxy -> S3."""

import os
import pathlib
import shutil
import subprocess
import sys
import uuid

import boto3
import modal
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel


class DownloadVideoRequest(BaseModel):
    youtube_url: str
    s3_key: str


image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg", "curl", "unzip")
    .run_commands(
        "curl -fsSL https://deno.land/install.sh | sh",
        "ln -s /root/.deno/bin/deno /usr/local/bin/deno",
    )
    .pip_install("boto3>=1.34.0", "fastapi[standard]>=0.110.0", "yt-dlp[default]")
)

app = modal.App("clipcast-downloader", image=image)
auth_scheme = HTTPBearer()


@app.function(
    cpu=2.0,
    memory=4096,
    timeout=1800,
    max_containers=4,
    scaledown_window=60,
    secrets=[modal.Secret.from_name("clipcast-secret")],
)
@modal.fastapi_endpoint(method="POST")
def download_youtube_video(
    request: DownloadVideoRequest,
    token: HTTPAuthorizationCredentials = Depends(auth_scheme),
):
    if token.credentials != os.environ["PROCESS_VIDEO_ENDPOINT_AUTH"]:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect bearer token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    proxy = os.environ.get("YT_DLP_PROXY", "").strip()
    if not proxy:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "YouTube blocks cloud datacenter IPs. Configure a rotating or sticky "
                "residential proxy URL in YT_DLP_PROXY and update clipcast-secret."
            ),
        )

    base_dir = pathlib.Path("/tmp") / str(uuid.uuid4())
    base_dir.mkdir(parents=True, exist_ok=True)
    output_template = base_dir / "source.%(ext)s"

    try:
        command = [
            sys.executable,
            "-m",
            "yt_dlp",
            "--proxy", proxy,
            "--js-runtimes", "deno",
            "--no-playlist",
            "--no-progress",
            "--retries", "8",
            "--fragment-retries", "8",
            "--socket-timeout", "30",
            "--concurrent-fragments", "4",
            "--sleep-requests", "1",
            # Preserve up to 4K. Merging/remuxing does not re-encode.
            "-f", "bv*[height<=2160]+ba/b[height<=2160]/b",
            "--merge-output-format", "mp4",
            "--remux-video", "mp4",
            "-o", str(output_template),
            request.youtube_url,
        ]
        result = subprocess.run(
            command, capture_output=True, text=True, timeout=1500
        )
        candidates = [
            path for path in base_dir.glob("source.*")
            if path.suffix not in {".part", ".ytdl"}
        ]
        if result.returncode != 0 or not candidates:
            error = (result.stderr or result.stdout or "Unknown yt-dlp failure")[-1200:]
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"YouTube download failed through residential proxy: {error}",
            )

        source_path = max(candidates, key=lambda path: path.stat().st_size)
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

        boto3.client("s3").upload_file(
            str(source_path),
            os.environ["S3_BUCKET_NAME"],
            request.s3_key,
            ExtraArgs={"ContentType": "video/mp4"},
        )
        print(f"Uploaded cloud source to S3 key {request.s3_key}")
        return {
            "success": True,
            "s3_key": request.s3_key,
            "duration": duration,
            "source_bytes": source_path.stat().st_size,
        }
    finally:
        shutil.rmtree(base_dir, ignore_errors=True)
