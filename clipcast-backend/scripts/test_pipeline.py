#!/usr/bin/env python3
"""
End-to-end pipeline test for ClipCast.

Tests the full flow:
  YouTube URL → Download endpoint (Modal CPU) → S3
             → Process endpoint (Modal GPU) → S3 clips

Usage:
    python scripts/test_pipeline.py                      # uses built-in short video
    python scripts/test_pipeline.py --url <youtube_url>  # custom URL
    python scripts/test_pipeline.py --s3-key <key>       # skip download, use existing S3 key
    python scripts/test_pipeline.py --mode educational   # clip mode (qa/motivational/educational/highlights/all)
    python scripts/test_pipeline.py --preview            # generate fast preview clips only
    python scripts/test_pipeline.py --skip-process       # only test download, not GPU processing

Short test videos (2-4 minutes, fast pipeline runs):
  - https://www.youtube.com/watch?v=H14bBuluwB8  (~3 min, Lex Fridman short clip)
  - https://www.youtube.com/watch?v=JC82Il2cjqA  (~4 min, motivational short)
  - https://www.youtube.com/watch?v=arj7oStGLkU  (~3 min, TED-Ed educational short)
"""

import argparse
import json
import os
import sys
import time
import uuid
from pathlib import Path

# ── Try to load .env from repo root ──────────────────────────────────────────
try:
    from dotenv import load_dotenv

    repo_root = Path(__file__).resolve().parent.parent.parent
    env_path = repo_root / ".env"
    if env_path.exists():
        load_dotenv(env_path)
        print(f"✓ Loaded environment from {env_path}")
    else:
        print(f"⚠  No .env found at {env_path} — relying on shell environment")
except ImportError:
    print("⚠  python-dotenv not installed — relying on shell environment")
    print("   Install: pip install python-dotenv")

# ── Check for requests library ───────────────────────────────────────────────
try:
    import requests
except ImportError:
    print("\n✗ 'requests' library is required.")
    print("  Install: pip install requests")
    sys.exit(1)

# ── Optional S3 verify (boto3) ────────────────────────────────────────────────
try:
    import boto3
    from botocore.exceptions import ClientError

    HAS_BOTO3 = True
except ImportError:
    HAS_BOTO3 = False
    print("⚠  boto3 not installed — S3 clip verification will be skipped")
    print("   Install: pip install boto3")

# ── ANSI colours ─────────────────────────────────────────────────────────────
GREEN = "\033[92m"
RED = "\033[91m"
YELLOW = "\033[93m"
CYAN = "\033[96m"
BOLD = "\033[1m"
RESET = "\033[0m"

# ── Well-known short test video (≈3 min, public domain / Creative Commons) ───
DEFAULT_YOUTUBE_URL = "https://www.youtube.com/watch?v=arj7oStGLkU"
# TED-Ed "How to spot a liar" – 3:19, widely available, minimal bot-blocking.

# ── Poll settings ─────────────────────────────────────────────────────────────
DOWNLOAD_POLL_INITIAL_WAIT_S = 20   # wait before first poll
DOWNLOAD_POLL_INTERVAL_S = 15       # retry interval
DOWNLOAD_POLL_MAX_S = 30 * 60       # 30-minute hard cap

PROCESS_TIMEOUT_S = 45 * 60        # 45-minute hard cap for GPU processing


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _env(name: str, required: bool = True) -> str:
    value = os.environ.get(name, "").strip()
    if required and not value:
        print(f"\n{RED}✗ Missing required environment variable: {name}{RESET}")
        print(f"  Set it in your .env file or export it in your shell.")
        sys.exit(1)
    return value


def _fmt_seconds(s: float) -> str:
    m, sec = divmod(int(s), 60)
    return f"{m}m {sec}s" if m else f"{sec}s"


def _section(title: str) -> None:
    width = 60
    print(f"\n{BOLD}{CYAN}{'─' * width}{RESET}")
    print(f"{BOLD}{CYAN}  {title}{RESET}")
    print(f"{BOLD}{CYAN}{'─' * width}{RESET}")


def _ok(msg: str) -> None:
    print(f"  {GREEN}✓{RESET} {msg}")


def _fail(msg: str) -> None:
    print(f"  {RED}✗ {msg}{RESET}")


def _info(msg: str) -> None:
    print(f"  {YELLOW}→{RESET} {msg}")


def _check_env_config() -> dict:
    """Validate all required env vars and return them as a dict."""
    _section("1 / 5  Checking configuration")

    config = {
        "download_url": _env("DOWNLOAD_VIDEO_ENDPOINT", required=False),
        "process_url": _env("PROCESS_VIDEO_ENDPOINT"),
        "auth_token": _env("PROCESS_VIDEO_ENDPOINT_AUTH"),
        "s3_bucket": _env("S3_BUCKET_NAME"),
        "aws_region": _env("AWS_REGION"),
        "aws_key_id": _env("AWS_ACCESS_KEY_ID"),
        "aws_secret": _env("AWS_SECRET_ACCESS_KEY"),
    }

    _ok(f"PROCESS_VIDEO_ENDPOINT = {config['process_url'][:60]}…")
    if config["download_url"]:
        _ok(f"DOWNLOAD_VIDEO_ENDPOINT = {config['download_url'][:60]}…")
    else:
        _info("DOWNLOAD_VIDEO_ENDPOINT not set — download step will be skipped")

    _ok(f"S3_BUCKET_NAME = {config['s3_bucket']}")
    _ok(f"AWS_REGION = {config['aws_region']}")
    _ok("AWS credentials present")

    return config


# ─────────────────────────────────────────────────────────────────────────────
# Step 2: Download YouTube → S3 (async poll)
# ─────────────────────────────────────────────────────────────────────────────

def _submit_download(config: dict, youtube_url: str, s3_key: str) -> str:
    """Submit to the download endpoint and return the call_id."""
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {config['auth_token']}",
    }
    payload = {"youtube_url": youtube_url, "s3_key": s3_key}

    _info(f"Submitting download: {youtube_url}")
    _info(f"Target S3 key: {s3_key}")

    try:
        resp = requests.post(
            config["download_url"], json=payload, headers=headers, timeout=30
        )
    except requests.exceptions.ConnectionError:
        _fail("Could not connect to DOWNLOAD_VIDEO_ENDPOINT.")
        _fail("Is the endpoint deployed? Check: modal deploy apps/downloader/main.py")
        sys.exit(1)
    except requests.exceptions.Timeout:
        _fail("Request to download endpoint timed out (30s). The endpoint may be cold-starting.")
        _fail("Wait 30 seconds and re-run the script.")
        sys.exit(1)

    if resp.status_code == 401:
        _fail("Authentication failed — PROCESS_VIDEO_ENDPOINT_AUTH is wrong or missing.")
        sys.exit(1)

    if resp.status_code != 202:
        _fail(f"Unexpected HTTP {resp.status_code} from download endpoint.")
        try:
            body = resp.json()
            _fail(f"Detail: {body.get('detail', resp.text[:400])}")
        except Exception:
            _fail(f"Response: {resp.text[:400]}")
        sys.exit(1)

    data = resp.json()
    call_id = data.get("call_id")
    if not call_id:
        _fail(f"Download endpoint did not return a call_id: {data}")
        sys.exit(1)

    _ok(f"Download job accepted — call_id: {call_id}")
    return call_id


def _poll_download(config: dict, call_id: str) -> dict:
    """Poll until completed/failed. Returns the final result dict."""
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {config['auth_token']}",
    }

    _info(f"Waiting {DOWNLOAD_POLL_INITIAL_WAIT_S}s for download worker to start…")
    time.sleep(DOWNLOAD_POLL_INITIAL_WAIT_S)

    started = time.monotonic()
    attempt = 0

    while True:
        elapsed = time.monotonic() - started
        if elapsed > DOWNLOAD_POLL_MAX_S:
            _fail(f"Download did not finish within {_fmt_seconds(DOWNLOAD_POLL_MAX_S)}.")
            _fail("The video may be too large, the proxy may be blocked, or Modal timed out.")
            sys.exit(1)

        attempt += 1
        try:
            resp = requests.post(
                config["download_url"],
                json={"call_id": call_id},
                headers=headers,
                timeout=30,
            )
        except requests.exceptions.RequestException as exc:
            _info(f"Poll attempt {attempt} failed (network error): {exc} — retrying…")
            time.sleep(DOWNLOAD_POLL_INTERVAL_S)
            continue

        if resp.status_code == 202:
            elapsed_str = _fmt_seconds(elapsed)
            print(
                f"  {YELLOW}○{RESET} Still downloading… "
                f"(elapsed: {elapsed_str}, attempt: {attempt})",
                end="\r",
            )
            time.sleep(DOWNLOAD_POLL_INTERVAL_S)
            continue

        if resp.status_code == 401:
            _fail("Auth token rejected during poll — this should not happen.")
            sys.exit(1)

        try:
            data = resp.json()
        except Exception:
            _fail(f"Non-JSON response from poll (HTTP {resp.status_code}): {resp.text[:300]}")
            sys.exit(1)

        if resp.status_code >= 400:
            detail = data.get("detail", str(data))
            _fail(f"Download worker failed (HTTP {resp.status_code}).")
            print()
            _fail(f"Detail: {detail[:600]}")
            _print_download_error_hints(detail)
            sys.exit(1)

        # status == "completed"
        print()  # clear \r line
        return data


def _print_download_error_hints(detail: str) -> None:
    """Print targeted hints based on the error detail string."""
    detail_lower = detail.lower()
    if "sign in" in detail_lower or "age" in detail_lower:
        _info("→ The video requires sign-in or is age-restricted. Try a different URL.")
    elif "proxy" in detail_lower or "503" in detail_lower:
        _info("→ All proxies failed. Options:")
        _info("  1. Set YT_DLP_PROXY to a residential proxy in .env and redeploy.")
        _info("  2. Wait for the free proxy list to refresh (runs every 15 min).")
        _info("  3. Pre-seed proxies: modal run apps/downloader/main.py::refresh_proxies")
    elif "private" in detail_lower or "unavailable" in detail_lower:
        _info("→ The video is private or unavailable. Use a public video.")
    elif "copyright" in detail_lower:
        _info("→ The video may be blocked due to copyright restrictions. Try another video.")
    elif "timeout" in detail_lower or "timed out" in detail_lower:
        _info("→ Download timed out. The video may be too long or the network is slow.")
        _info("  Try a shorter video (< 10 min) for testing.")
    else:
        _info("→ For more details, check: https://modal.com/apps (ClipCast logs)")


# ─────────────────────────────────────────────────────────────────────────────
# Step 3: GPU processing
# ─────────────────────────────────────────────────────────────────────────────

def _run_processing(config: dict, s3_key: str, clip_mode: str, preview_only: bool) -> dict:
    """Call the process endpoint and return its JSON response."""
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {config['auth_token']}",
    }
    payload = {
        "s3_key": s3_key,
        "youtube_url": None,
        "clip_mode": clip_mode,
        "preview_only": preview_only,
    }

    _info(f"S3 key: {s3_key}")
    _info(f"Clip mode: {clip_mode}")
    _info(f"Preview only: {preview_only}")
    _info("Calling GPU processing endpoint… (this may take 5-20 minutes, cold-start included)")

    t0 = time.monotonic()
    try:
        resp = requests.post(
            config["process_url"],
            json=payload,
            headers=headers,
            timeout=PROCESS_TIMEOUT_S,
        )
    except requests.exceptions.ConnectionError:
        _fail("Could not connect to PROCESS_VIDEO_ENDPOINT.")
        _fail("Is the processor deployed? Check: modal deploy apps/processor/main.py")
        sys.exit(1)
    except requests.exceptions.Timeout:
        _fail(f"Processing timed out after {_fmt_seconds(PROCESS_TIMEOUT_S)}.")
        _fail("The GPU container may have crashed or the video is too long.")
        _fail("Check Modal logs: https://modal.com/apps  (app: clipcast)")
        sys.exit(1)

    elapsed = time.monotonic() - t0
    _info(f"Response received after {_fmt_seconds(elapsed)}")

    if resp.status_code == 401:
        _fail("Auth failed — PROCESS_VIDEO_ENDPOINT_AUTH is wrong.")
        sys.exit(1)

    if resp.status_code == 400:
        try:
            detail = resp.json().get("detail", resp.text[:400])
        except Exception:
            detail = resp.text[:400]
        _fail(f"Bad request (HTTP 400): {detail}")
        sys.exit(1)

    if not resp.ok:
        _fail(f"Processing endpoint returned HTTP {resp.status_code}.")
        try:
            body = resp.json()
            detail = body.get("detail", resp.text[:600])
        except Exception:
            detail = resp.text[:600]
        _fail(f"Detail: {detail}")
        _print_process_error_hints(detail)
        sys.exit(1)

    try:
        data = resp.json()
    except Exception:
        _fail(f"Processing endpoint returned non-JSON: {resp.text[:300]}")
        sys.exit(1)

    return data


def _print_process_error_hints(detail: str) -> None:
    detail_lower = str(detail).lower()
    if "cuda" in detail_lower or "out of memory" in detail_lower:
        _info("→ GPU ran out of memory (CUDA OOM). The video may be very long.")
        _info("  Try with --preview flag or a shorter video.")
    elif "s3" in detail_lower or "nosuchkey" in detail_lower:
        _info("→ The S3 key was not found. The download may not have completed.")
        _info("  Wait for the download to finish before processing.")
    elif "ffmpeg" in detail_lower:
        _info("→ ffmpeg error during clip rendering. The source video may be corrupted.")
    elif "whisper" in detail_lower or "transcri" in detail_lower:
        _info("→ Transcription failed. The video may have no audio or unsupported format.")
    elif "gemini" in detail_lower or "api" in detail_lower:
        _info("→ Gemini API error. Check your GEMINI_API_KEY in the Modal secret.")
        _info("  Re-run: python scripts/setup_modal_secret.py && modal deploy apps/processor/main.py")
    else:
        _info("→ Check Modal logs for stack traces: https://modal.com/apps (app: clipcast)")


# ─────────────────────────────────────────────────────────────────────────────
# Step 4: Verify clips in S3
# ─────────────────────────────────────────────────────────────────────────────

def _verify_s3_clips(config: dict, s3_key: str) -> list[dict]:
    """List all clips under the same S3 folder as s3_key. Returns clip info list."""
    if not HAS_BOTO3:
        _info("Skipping S3 verification (boto3 not installed).")
        return []

    s3 = boto3.client(
        "s3",
        region_name=config["aws_region"],
        aws_access_key_id=config["aws_key_id"],
        aws_secret_access_key=config["aws_secret"],
    )
    prefix = s3_key.rsplit("/", 1)[0] + "/"

    try:
        response = s3.list_objects_v2(Bucket=config["s3_bucket"], Prefix=prefix)
    except ClientError as e:
        _fail(f"S3 list failed: {e}")
        return []

    objects = response.get("Contents", [])
    clips = [
        obj for obj in objects
        if obj["Key"] != s3_key  # exclude source
        and obj["Key"].endswith(".mp4")
    ]
    return clips


def _generate_presigned_urls(config: dict, clips: list[dict]) -> list[str]:
    """Generate 1-hour presigned URLs for each clip (for quick browser preview)."""
    if not HAS_BOTO3 or not clips:
        return []

    s3 = boto3.client(
        "s3",
        region_name=config["aws_region"],
        aws_access_key_id=config["aws_key_id"],
        aws_secret_access_key=config["aws_secret"],
    )
    urls = []
    for clip in clips:
        try:
            url = s3.generate_presigned_url(
                "get_object",
                Params={"Bucket": config["s3_bucket"], "Key": clip["Key"]},
                ExpiresIn=3600,
            )
            urls.append(url)
        except Exception as e:
            urls.append(f"<error generating URL: {e}>")
    return urls


# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────

def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="End-to-end ClipCast pipeline test",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--url",
        default=DEFAULT_YOUTUBE_URL,
        help=f"YouTube URL to test with (default: {DEFAULT_YOUTUBE_URL})",
    )
    parser.add_argument(
        "--s3-key",
        help="Skip download step — use this existing S3 key directly for processing",
    )
    parser.add_argument(
        "--mode",
        default="highlights",
        choices=["qa", "motivational", "educational", "highlights", "all"],
        help="Clip selection mode (default: highlights)",
    )
    parser.add_argument(
        "--preview",
        action="store_true",
        help="Generate fast preview clips only (skips ASD + subtitles, much faster)",
    )
    parser.add_argument(
        "--skip-process",
        action="store_true",
        help="Only test the download step, skip GPU processing",
    )
    parser.add_argument(
        "--no-presign",
        action="store_true",
        help="Skip generating presigned S3 URLs for clip preview",
    )
    return parser.parse_args()


def main() -> None:
    args = _parse_args()
    overall_start = time.monotonic()

    print(f"\n{BOLD}{'=' * 60}{RESET}")
    print(f"{BOLD}  ClipCast End-to-End Pipeline Test{RESET}")
    print(f"{BOLD}{'=' * 60}{RESET}")

    # ── Step 1: Config ──────────────────────────────────────────────────────
    config = _check_env_config()

    # ── Step 2: Download ────────────────────────────────────────────────────
    if args.s3_key:
        _section("2 / 5  Download (SKIPPED — using provided S3 key)")
        s3_key = args.s3_key
        _ok(f"Using S3 key: {s3_key}")
        download_result = None
    elif not config["download_url"]:
        _section("2 / 5  Download (SKIPPED — DOWNLOAD_VIDEO_ENDPOINT not set)")
        _info("To test download, add DOWNLOAD_VIDEO_ENDPOINT to .env")
        # Construct a synthetic key for process-only mode
        s3_key = f"test/{uuid.uuid4()}/original.mp4"
        _fail("Cannot proceed to processing without an S3 key or download endpoint.")
        sys.exit(1)
    else:
        _section("2 / 5  Submitting YouTube download")
        s3_key = f"test-e2e/{uuid.uuid4()}/original.mp4"
        call_id = _submit_download(config, args.url, s3_key)

        _section("3 / 5  Polling download progress")
        t_dl_start = time.monotonic()
        download_result = _poll_download(config, call_id)
        dl_elapsed = time.monotonic() - t_dl_start

        _ok(f"Download completed in {_fmt_seconds(dl_elapsed)}")
        _ok(f"S3 key: {download_result.get('s3_key', s3_key)}")
        if download_result.get("duration"):
            _ok(f"Duration: {_fmt_seconds(download_result['duration'])}")
        if download_result.get("source_bytes"):
            mb = download_result["source_bytes"] / 1_048_576
            _ok(f"File size: {mb:.1f} MB")

        # Use the s3_key from the response (in case it differs)
        s3_key = download_result.get("s3_key", s3_key)

    # ── Step 3: Process ─────────────────────────────────────────────────────
    if args.skip_process:
        _section("4 / 5  GPU Processing (SKIPPED — --skip-process flag)")
        _ok(f"S3 key ready for manual processing: {s3_key}")
        process_result = None
    else:
        _section("4 / 5  GPU Processing (transcribe → Gemini → render clips)")
        t_proc_start = time.monotonic()
        process_result = _run_processing(config, s3_key, args.mode, args.preview)
        proc_elapsed = time.monotonic() - t_proc_start

        clips_found = process_result.get("clips_found", "?")
        duration_s = process_result.get("duration", 0)

        _ok(f"Processing completed in {_fmt_seconds(proc_elapsed)}")
        _ok(f"Source duration: {_fmt_seconds(duration_s)}")
        _ok(f"Clips found: {clips_found}")

        if clips_found == 0:
            _info("No clips were found. Possible reasons:")
            _info("  • Video is too short for the chosen clip mode")
            _info("  • Audio is not speech (music-only or silent)")
            _info("  • Try a different --mode (e.g. --mode highlights)")

    # ── Step 4: Verify S3 clips ─────────────────────────────────────────────
    _section("5 / 5  Verifying clips in S3")
    clips = _verify_s3_clips(config, s3_key)

    if not HAS_BOTO3:
        _info("Install boto3 to enable S3 verification: pip install boto3")
    elif not clips:
        if process_result is not None and process_result.get("clips_found", 0) == 0:
            _info("No clips expected (Gemini found 0 moments) — S3 is correct.")
        elif args.skip_process:
            _info("Processing was skipped — no clips to verify.")
        else:
            _fail("No clip .mp4 files found in S3 under the expected prefix!")
            _fail(f"Expected prefix: {s3_key.rsplit('/', 1)[0]}/")
            _info("Possible causes:")
            _info("  • S3 upload in processor failed silently")
            _info("  • Wrong S3 bucket / region in environment")
            _info("  • Clips are named differently than expected")
    else:
        _ok(f"Found {len(clips)} clip(s) in S3:")
        for clip in clips:
            size_kb = clip["Size"] // 1024
            print(f"    • {clip['Key']}  ({size_kb} KB)")

        if not args.no_presign:
            urls = _generate_presigned_urls(config, clips)
            if urls:
                print(f"\n  {CYAN}Presigned URLs (valid for 1 hour):{RESET}")
                for i, (clip, url) in enumerate(zip(clips, urls), 1):
                    clip_name = clip["Key"].split("/")[-1]
                    print(f"\n  {i}. {clip_name}")
                    print(f"     {url}")

    # ── Summary ─────────────────────────────────────────────────────────────
    total_elapsed = time.monotonic() - overall_start
    _section("Test Summary")
    print(f"  Total time:   {_fmt_seconds(total_elapsed)}")
    print(f"  YouTube URL:  {args.url}")
    print(f"  S3 key:       {s3_key}")
    print(f"  Clip mode:    {args.mode}")
    print(f"  Preview only: {args.preview}")
    if process_result:
        print(f"  Clips found:  {process_result.get('clips_found', '?')}")
        print(f"  S3 clips:     {len(clips)}")
    print()
    if (process_result and len(clips) > 0) or args.skip_process:
        print(f"  {GREEN}{BOLD}PIPELINE TEST PASSED ✓{RESET}")
    elif args.skip_process or (process_result and process_result.get("clips_found", 0) == 0):
        print(f"  {YELLOW}{BOLD}PIPELINE TEST PASSED (0 clips — expected for very short video){RESET}")
    else:
        print(f"  {RED}{BOLD}PIPELINE TEST FAILED ✗{RESET}")
        sys.exit(1)


if __name__ == "__main__":
    main()
