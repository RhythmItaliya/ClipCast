#!/usr/bin/env python3
"""
ClipCast end-to-end pipeline harness (NEW).

Exercises the REAL production flow against the deployed Modal endpoints, but
drives the download through the LOCAL yt-dlp fallback endpoint (the dev server's
/api/local-download) so a home/residential IP is used instead of a blocked
datacenter proxy.

Two independent flows:

  CLIP FLOW (default)
    YouTube URL --> LOCAL download endpoint (yt-dlp on this machine, uploads the
    source to S3) --> processor endpoint (transcribe -> Gemini moment-selection
    -> ASD reframe 9:16 -> burn captions -> upload clips to S3).
    Verifies: clip count > 0, each clip's duration vs the 30-60s target window,
    and that captions were burned (unless --preview).

  AUDIO FLOW (--audio / --audio-only)
    Submits a prompt-based "generate" job to the Audio Studio mixer endpoint,
    polls until done, and verifies an output artifact (S3 key + presigned URL).

The request/response shapes here are copied from the real contracts:
  - clipcast-frontend/src/app/api/local-download/route.ts   (local download)
  - clipcast-backend/apps/processor/main.py  (ProcessVideoRequest / process_video)
  - clipcast-backend/apps/mixer/main.py       (ProcessAudioRequest / process_audio)
  - clipcast-frontend/src/inngest/functions.ts (how the app builds each payload)

IMPORTANT: real runs cost money and GPU time and hit real Modal. There is a
2-job active-concurrency limit (one clip + one audio is fine). This script does
NOT run any Modal job on --help or a dry import; it only acts when invoked with
real work.

Usage examples:
    # fast preview clip run (skips ASD + captions, cheapest)
    python3 testing/e2e_full_pipeline.py --preview

    # full run, exhaustive "all" fan-out (default mode)
    python3 testing/e2e_full_pipeline.py --url https://youtu.be/<id> --mode all

    # reuse an already-downloaded S3 source, skip the local download step
    python3 testing/e2e_full_pipeline.py --s3-key test-e2e/<uuid>/original.mp4

    # clip run + an audio-studio generate job
    python3 testing/e2e_full_pipeline.py --preview --audio

    # audio-studio only
    python3 testing/e2e_full_pipeline.py --audio-only \
        --audio-prompt "warm lofi hip hop, jazzy keys, relaxed"

Environment variables consumed (read from the repo-root .env, or the shell):
    LOCAL_DOWNLOAD_ENDPOINT   local yt-dlp fallback (default http://localhost:3000/api/local-download)
    PROCESS_VIDEO_ENDPOINT    processor (clip) endpoint                      [required for clip flow]
    PROCESS_AUDIO_ENDPOINT    mixer / Audio Studio endpoint                  [required for --audio]
    PROCESS_VIDEO_ENDPOINT_AUTH  shared bearer token for processor + mixer   [required]
    S3_BUCKET_NAME, AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY     [required; presign is optional]
    Optional LLM overrides (see resolve_llm_config): CLIPCAST_LLM_PROVIDER,
    CLIPCAST_LLM_MODEL, CLIPCAST_LLM_EFFORT, CLIPCAST_LLM_BASE_URL, and the
    provider key envs ANTHROPIC_API_KEY / GEMINI_API_KEY / DEEPSEEK_API_KEY /
    OPENAI_API_KEY.

Exit code: 0 if every executed stage passed, 1 otherwise.
"""

from __future__ import annotations

import argparse
import json
import os
import socket
import sys
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timezone
from pathlib import Path

# ── Paths ─────────────────────────────────────────────────────────────────────
HERE = Path(__file__).resolve().parent            # testing/
REPO_ROOT = HERE.parent                            # ClipCast/
ENV_PATH = REPO_ROOT / ".env"
REPORTS_DIR = HERE / "reports"

# ── Defaults ──────────────────────────────────────────────────────────────────
DEFAULT_LOCAL_DOWNLOAD_ENDPOINT = "http://localhost:3000/api/local-download"
# TED-Ed "How to spot a liar" (~3:19) — short, public, minimal bot-blocking.
# Same well-known test source used by scripts/test_pipeline.py.
DEFAULT_YOUTUBE_URL = "https://www.youtube.com/watch?v=arj7oStGLkU"
DEFAULT_AUDIO_PROMPT = "upbeat lofi hip hop instrumental, mellow, jazzy keys, relaxed study vibe"

CLIP_MODES = ["qa", "educational", "motivational", "highlights", "any", "all"]

# Product target window for a finished clip (docs/13 + the processor prompts ask
# for 40-60s, MIN_CLIP_SECONDS=15 hard floor, 120s hard ceiling in main.py). We
# treat 30-60s as the *target* window: clips outside it are reported as warnings
# (they can legitimately be 15-120s), while the load-bearing pass/fail is driven
# by "clips exist" + "captions burned".
CLIP_TARGET_MIN_S = 30
CLIP_TARGET_MAX_S = 60

# Poll / timeout tuning (seconds).
DEFAULT_PROCESS_TIMEOUT_S = 45 * 60     # processor is synchronous; long single POST
LOCAL_DOWNLOAD_TIMEOUT_S = 32 * 60      # local yt-dlp route caps its own run at 30 min
AUDIO_SUBMIT_TIMEOUT_S = 60
AUDIO_POLL_TIMEOUT_S = 60
AUDIO_INITIAL_WAIT_S = 20               # mirrors functions.ts runMixer wait-start
AUDIO_POLL_MIN_S = 15
AUDIO_POLL_MAX_S = 60

# ── ANSI colours ──────────────────────────────────────────────────────────────
GREEN, RED, YELLOW, CYAN, BOLD, DIM, RESET = (
    "\033[92m", "\033[91m", "\033[93m", "\033[96m", "\033[1m", "\033[2m", "\033[0m"
)

# ── Optional boto3 (presigned URLs + belt-and-suspenders S3 listing) ──────────
try:
    import boto3
    from botocore.exceptions import BotoCoreError, ClientError

    HAS_BOTO3 = True
except ImportError:  # pragma: no cover - boto3 is in requirements but optional here
    HAS_BOTO3 = False


# ─────────────────────────────────────────────────────────────────────────────
# Small, dependency-free helpers
# ─────────────────────────────────────────────────────────────────────────────
class HarnessError(Exception):
    """Any expected, reportable failure of a stage."""


def load_env_file(path: Path) -> int:
    """Minimal .env parser (no external deps).

    Supports `KEY=value`, `KEY="value"`, `KEY='value'`, `export KEY=value`,
    blank lines and `#` comments. Existing shell environment wins (like
    python-dotenv's default), so an explicit `export FOO=... ` still overrides
    the file. Returns the number of keys loaded.
    """
    if not path.exists():
        return 0
    loaded = 0
    for raw in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[len("export "):].strip()
        if "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
            value = value[1:-1]
        if key and key not in os.environ:
            os.environ[key] = value
            loaded += 1
    return loaded


def env(name: str, required: bool = False, default: str = "") -> str:
    value = os.environ.get(name, default)
    value = value.strip() if value else ""
    if required and not value:
        raise HarnessError(f"Missing required environment variable: {name}")
    return value


def http_post_json(url: str, payload: dict, bearer: str | None = None,
                   timeout: float = 60) -> tuple[int, dict | None, str]:
    """POST JSON via stdlib urllib. Returns (status_code, parsed_json_or_None, raw_body).

    Raises HarnessError on connection/timeout problems (never on an HTTP error
    status — those come back as (status, ...) so the caller can inspect them).
    """
    data = json.dumps(payload).encode("utf-8")
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if bearer:
        headers["Authorization"] = f"Bearer {bearer}"
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read().decode("utf-8", "replace")
            status = resp.status
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", "replace") if exc.fp else ""
        status = exc.code
    except (urllib.error.URLError, socket.timeout, TimeoutError) as exc:
        reason = getattr(exc, "reason", exc)
        raise HarnessError(f"Could not reach {url}: {reason}") from exc
    parsed: dict | None
    try:
        loaded = json.loads(body)
        parsed = loaded if isinstance(loaded, dict) else None
    except (json.JSONDecodeError, ValueError):
        parsed = None
    return status, parsed, body


def fmt_seconds(s: float) -> str:
    m, sec = divmod(int(s), 60)
    return f"{m}m {sec}s" if m else f"{sec}s"


def truncate(text: str, n: int = 400) -> str:
    text = (text or "").strip()
    return text if len(text) <= n else text[: n - 1] + "…"


def mask_endpoint(url: str) -> str:
    """Show enough of an endpoint to identify it, without leaking a full token
    in a query string (endpoints here don't carry tokens, but be safe)."""
    if not url:
        return "(unset)"
    return truncate(url, 72)


# ── Console logging ───────────────────────────────────────────────────────────
def section(title: str) -> None:
    bar = "─" * 64
    print(f"\n{BOLD}{CYAN}{bar}{RESET}")
    print(f"{BOLD}{CYAN}  {title}{RESET}")
    print(f"{BOLD}{CYAN}{bar}{RESET}")


def ok(msg: str) -> None:
    print(f"  {GREEN}✓{RESET} {msg}")


def warn(msg: str) -> None:
    print(f"  {YELLOW}!{RESET} {msg}")


def fail(msg: str) -> None:
    print(f"  {RED}✗ {msg}{RESET}")


def info(msg: str) -> None:
    print(f"  {DIM}→ {msg}{RESET}")


# ─────────────────────────────────────────────────────────────────────────────
# Report accumulator
# ─────────────────────────────────────────────────────────────────────────────
class Report:
    def __init__(self, args: argparse.Namespace):
        self.started = time.monotonic()
        self.started_utc = datetime.now(timezone.utc)
        self.args = vars(args).copy()
        self.stages: list[dict] = []
        self.environment: dict = {}
        self.llm: dict = {}
        self.clips: list[dict] = []
        self.audio: dict = {}
        self.bugs: list[str] = []

    def stage(self, name: str, status: str, seconds: float,
              detail: str = "", error: str = "") -> None:
        self.stages.append({
            "name": name,
            "status": status,            # PASS | FAIL | SKIP | WARN
            "seconds": round(seconds, 1),
            "detail": detail,
            "error": error,
        })

    def bug(self, msg: str) -> None:
        self.bugs.append(msg)
        warn(f"POSSIBLE BUG: {msg}")

    @property
    def overall(self) -> str:
        return "FAIL" if any(s["status"] == "FAIL" for s in self.stages) else "PASS"

    def to_dict(self) -> dict:
        return {
            "harness": "e2e_full_pipeline",
            "started_at_utc": self.started_utc.isoformat(),
            "finished_at_utc": datetime.now(timezone.utc).isoformat(),
            "total_seconds": round(time.monotonic() - self.started, 1),
            "overall_status": self.overall,
            "args": self.args,
            "environment": self.environment,
            "llm": self.llm,
            "stages": self.stages,
            "clips": self.clips,
            "audio": self.audio,
            "bugs": self.bugs,
        }


# ─────────────────────────────────────────────────────────────────────────────
# Config + LLM resolution
# ─────────────────────────────────────────────────────────────────────────────
def check_config(report: Report, need_clip: bool, need_audio: bool) -> dict:
    section("Configuration")
    cfg = {
        "local_download": env("LOCAL_DOWNLOAD_ENDPOINT") or DEFAULT_LOCAL_DOWNLOAD_ENDPOINT,
        "process_video": env("PROCESS_VIDEO_ENDPOINT"),
        "process_audio": env("PROCESS_AUDIO_ENDPOINT"),
        "auth_token": env("PROCESS_VIDEO_ENDPOINT_AUTH", required=True),
        "s3_bucket": env("S3_BUCKET_NAME"),
        "aws_region": env("AWS_REGION"),
        "aws_key_id": env("AWS_ACCESS_KEY_ID"),
        "aws_secret": env("AWS_SECRET_ACCESS_KEY"),
    }
    if need_clip and not cfg["process_video"]:
        raise HarnessError("PROCESS_VIDEO_ENDPOINT is required for the clip flow.")
    if need_audio and not cfg["process_audio"]:
        raise HarnessError("PROCESS_AUDIO_ENDPOINT is required for the audio flow (--audio).")

    ok(f"LOCAL_DOWNLOAD_ENDPOINT = {mask_endpoint(cfg['local_download'])}")
    if need_clip:
        ok(f"PROCESS_VIDEO_ENDPOINT = {mask_endpoint(cfg['process_video'])}")
    if need_audio:
        ok(f"PROCESS_AUDIO_ENDPOINT = {mask_endpoint(cfg['process_audio'])}")
    ok("PROCESS_VIDEO_ENDPOINT_AUTH present")
    if cfg["s3_bucket"]:
        ok(f"S3_BUCKET_NAME = {cfg['s3_bucket']}  (region {cfg['aws_region'] or '?'})")
    else:
        warn("S3_BUCKET_NAME unset — presigned-URL verification will be skipped.")
    if not HAS_BOTO3:
        info("boto3 not importable — presigned URLs will be skipped (pip install boto3).")

    report.environment = {
        "local_download_endpoint": mask_endpoint(cfg["local_download"]),
        "process_video_endpoint": mask_endpoint(cfg["process_video"]),
        "process_audio_endpoint": mask_endpoint(cfg["process_audio"]),
        "s3_bucket": cfg["s3_bucket"],
        "aws_region": cfg["aws_region"],
        "boto3_available": HAS_BOTO3,
        "python": sys.version.split()[0],
    }
    return cfg


# Provider -> the .env key that holds that provider's API key. The real app
# passes a per-job key decrypted from the DB (ProviderKey / AES-GCM); this
# harness bypasses the DB, so it can only forward a key that also lives in .env.
PROVIDER_KEY_ENV = {
    "claude": "ANTHROPIC_API_KEY",
    "anthropic": "ANTHROPIC_API_KEY",
    "gemini": "GEMINI_API_KEY",
    "deepseek": "DEEPSEEK_API_KEY",
    "openai": "OPENAI_API_KEY",
}


def resolve_llm_config(report: Report, provider_arg: str) -> dict:
    """Build the per-job llm_* fields the processor + mixer accept.

    TODO(contract gap): the production per-job LLM config (provider key, model,
    effort, base URL) is stored ENCRYPTED in the app DB (ProviderKey / AES-GCM,
    see clipcast-frontend/src/server/provider-keys.ts) and resolved by
    inngest/functions.ts::resolveLlmConfig at dispatch. This harness talks to
    Modal directly and cannot read that encrypted config. So it forwards:
      - llm_provider : the chosen provider (recorded in the report),
      - llm_api_key  : that provider's key from .env IF present, else null,
      - llm_model / llm_effort / llm_base_url : the CLIPCAST_LLM_* overrides IF
        present, else null.
    A null field means "backend falls back to its own Modal-secret default",
    which is a valid, working path (the crew degrades gracefully). To reproduce
    the exact DB-configured setup (e.g. Opus 4.8 via a gateway), set
    CLIPCAST_LLM_MODEL / CLIPCAST_LLM_EFFORT / CLIPCAST_LLM_BASE_URL and the
    provider key env before running.
    """
    provider = (provider_arg or "").strip().lower() or "claude"
    key_env = PROVIDER_KEY_ENV.get(provider)
    api_key = env(key_env) if key_env else ""
    model = env("CLIPCAST_LLM_MODEL")
    effort = env("CLIPCAST_LLM_EFFORT")
    base_url = env("CLIPCAST_LLM_BASE_URL")

    report.llm = {
        "provider": provider,
        "model": model or "(backend default)",
        "effort": effort or "(backend default)",
        "base_url_set": bool(base_url),
        "api_key_source": key_env if api_key else "(backend Modal secret)",
    }
    info(
        f"LLM crew provider: {provider} · model {model or 'backend default'} · "
        f"key {'from ' + key_env if api_key else 'from Modal secret'}"
    )
    return {
        "llm_provider": provider,
        "llm_api_key": api_key or None,
        "llm_model": model or None,
        "llm_effort": effort or None,
        "llm_base_url": base_url or None,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Stage: local download (YouTube -> yt-dlp on this box -> S3)
# ─────────────────────────────────────────────────────────────────────────────
def stage_local_download(report: Report, cfg: dict, youtube_url: str) -> str:
    section("Stage 1 — Local download (yt-dlp -> S3)")
    s3_key = f"test-e2e/{uuid.uuid4()}/original.mp4"
    info(f"YouTube URL: {youtube_url}")
    info(f"Target S3 key: {s3_key}")
    info("Requires the dev server running (npm run dev) so /api/local-download is live.")
    t0 = time.monotonic()

    # Contract mirrors clipcast-frontend/src/app/api/local-download/route.ts:
    #   request  { youtube_url, s3_key }   (no auth header; dev-only route)
    #   response { status:"completed", s3_key, duration, source_bytes, title, uploader }
    try:
        status, data, body = http_post_json(
            cfg["local_download"],
            {"youtube_url": youtube_url, "s3_key": s3_key},
            timeout=LOCAL_DOWNLOAD_TIMEOUT_S,
        )
    except HarnessError as exc:
        elapsed = time.monotonic() - t0
        fail(str(exc))
        info("Is the Next.js dev server up? Start it with: npm run dev")
        report.stage("local_download", "FAIL", elapsed, error=str(exc))
        raise

    elapsed = time.monotonic() - t0
    if status != 200 or not data:
        detail = truncate((data or {}).get("detail", body) if isinstance(data, dict) else body, 500)
        fail(f"Local download returned HTTP {status}: {detail}")
        report.stage("local_download", "FAIL", elapsed,
                     error=f"HTTP {status}: {detail}")
        raise HarnessError(f"Local download failed (HTTP {status}).")

    returned_key = data.get("s3_key") or s3_key
    duration = data.get("duration") or 0
    size_mb = (data.get("source_bytes") or 0) / 1_048_576
    ok(f"Downloaded + uploaded to S3 in {fmt_seconds(elapsed)}")
    ok(f"S3 key: {returned_key}")
    if data.get("title"):
        info(f"Title: {data['title']}  ·  Uploader: {data.get('uploader') or '?'}")
    if duration:
        info(f"Source duration: {fmt_seconds(duration)}  ·  {size_mb:.1f} MB")
    report.stage("local_download", "PASS", elapsed,
                 detail=f"s3_key={returned_key}, duration={duration}s, {size_mb:.1f}MB")
    return returned_key


# ─────────────────────────────────────────────────────────────────────────────
# Stage: processor (clips)
# ─────────────────────────────────────────────────────────────────────────────
def stage_process_clips(report: Report, cfg: dict, s3_key: str, mode: str,
                        preview: bool, llm: dict, timeout: float) -> dict:
    section(f"Stage 2 — Processor (mode={mode}, preview={preview})")
    # Contract mirrors ProcessVideoRequest in apps/processor/main.py and the
    # payload assembled in inngest/functions.ts (step.fetch). The endpoint is
    # SYNCHRONOUS: one POST returns the final result (no submit/poll).
    payload = {
        "s3_key": s3_key,
        "youtube_url": None,          # already on S3; processor rejects a non-null url
        "clip_mode": mode,
        "preview_only": preview,
        "caption_color": None,        # None => Colorist agent picks per-clip color
        "watermark_text": None,       # None => no watermark burned
        **llm,
    }
    info(f"S3 key: {s3_key}")
    info(f"Calling processor (may take 5-20+ min incl. cold start); timeout {fmt_seconds(timeout)}")
    t0 = time.monotonic()
    try:
        status, data, body = http_post_json(
            cfg["process_video"], payload, bearer=cfg["auth_token"], timeout=timeout
        )
    except HarnessError as exc:
        elapsed = time.monotonic() - t0
        fail(str(exc))
        report.stage("process_clips", "FAIL", elapsed, error=str(exc))
        raise

    elapsed = time.monotonic() - t0
    if status == 401:
        report.stage("process_clips", "FAIL", elapsed, error="401 auth rejected")
        raise HarnessError("Processor rejected the bearer token (PROCESS_VIDEO_ENDPOINT_AUTH).")
    if status != 200 or not data:
        detail = truncate((data or {}).get("detail", body) if isinstance(data, dict) else body, 600)
        fail(f"Processor returned HTTP {status}: {detail}")
        report.stage("process_clips", "FAIL", elapsed, error=f"HTTP {status}: {detail}")
        raise HarnessError(f"Processor failed (HTTP {status}).")

    ok(f"Processor completed in {fmt_seconds(elapsed)}")
    ok(f"Source duration: {fmt_seconds(data.get('duration') or 0)}")
    ok(f"clips_found={data.get('clips_found')} · clips_rendered={data.get('clips_rendered')}")
    if data.get("processing_summary"):
        info(f"Summary: {truncate(data['processing_summary'], 200)}")
    if data.get("clip_warnings"):
        for w in data["clip_warnings"]:
            warn(f"clip render warning: {truncate(w, 200)}")
    report.stage("process_clips", "PASS", elapsed,
                 detail=f"found={data.get('clips_found')}, rendered={data.get('clips_rendered')}")
    return data


def verify_clips(report: Report, cfg: dict, result: dict, preview: bool,
                 no_presign: bool) -> None:
    section("Stage 3 — Verify clips")
    clips = result.get("clips") or []
    t0 = time.monotonic()

    # (1) clip count > 0  (the load-bearing check)
    if not clips:
        fail("No clips returned by the processor.")
        # An empty result is only 'expected' when Gemini genuinely found no
        # moments; otherwise it's a real failure worth surfacing.
        if not result.get("clips_found"):
            report.bug("clips_found=0 — video too short/off-topic for the mode, or "
                       "moment-selection returned nothing.")
        report.stage("verify_clips", "FAIL", time.monotonic() - t0,
                     error="0 clips returned")
        raise HarnessError("Verification failed: 0 clips.")
    ok(f"Clip count: {len(clips)} (> 0)")

    presign = _s3_presigner(cfg) if (HAS_BOTO3 and not no_presign and cfg["s3_bucket"]) else None

    all_in_window = True
    captions_ok = True
    for i, clip in enumerate(clips):
        key = clip.get("s3_key", "")
        name = key.rsplit("/", 1)[-1]
        dur = clip.get("duration")
        in_window = isinstance(dur, (int, float)) and CLIP_TARGET_MIN_S <= dur <= CLIP_TARGET_MAX_S
        # Caption verification is indirect: the processor's full render path
        # writes clip_<i>.mp4 AFTER create_subtitles_with_ffmpeg() burns
        # captions; the preview path writes preview_<i>.mp4 and skips captions.
        # TODO(contract gap): the response carries no explicit "captions" flag,
        # and a byte-accurate check would need to download the clip and OCR a
        # frame (intentionally out of scope — cost/time). We use the render-path
        # filename as the strongest available signal.
        burned = name.startswith("clip_")
        if not preview and not burned:
            captions_ok = False
        if not in_window:
            all_in_window = False

        presigned = presign(key) if (presign and key) else None
        report.clips.append({
            "index": i,
            "s3_key": key,
            "title": clip.get("title"),
            "category": clip.get("category"),
            "duration": dur,
            "in_target_window": bool(in_window),
            "captions_burned": (None if preview else burned),
            "presigned_url": presigned,
        })
        window_note = "" if in_window else f"  {YELLOW}(outside {CLIP_TARGET_MIN_S}-{CLIP_TARGET_MAX_S}s target){RESET}"
        cap_note = "" if preview else (f"  captions={'yes' if burned else 'NO'}")
        print(f"    {i+1}. {truncate(str(clip.get('title') or name), 48):48} "
              f"{str(dur) + 's':>5}{window_note}{cap_note}")
        if presigned:
            print(f"       {DIM}{presigned}{RESET}")

    # (2) duration window — reported as a warning, not a hard failure (the
    # backend legitimately allows 15-120s; 30-60s is the product target).
    if all_in_window:
        ok(f"All clips within the {CLIP_TARGET_MIN_S}-{CLIP_TARGET_MAX_S}s target window.")
    else:
        warn(f"Some clips fall outside the {CLIP_TARGET_MIN_S}-{CLIP_TARGET_MAX_S}s "
             f"target window (allowed by backend, but flagged).")

    # (3) captions burned (unless preview) — load-bearing for a full run.
    if preview:
        info("Preview mode: captions intentionally skipped — not checked.")
        status = "PASS"
    elif captions_ok:
        ok("Captions burned into every clip (clip_*.mp4 render path).")
        status = "PASS"
    else:
        fail("At least one clip did not go through the caption-burning render path.")
        report.bug("A non-preview clip was not named clip_*.mp4 — captions may be missing.")
        status = "FAIL"

    report.stage("verify_clips", status, time.monotonic() - t0,
                 detail=f"{len(clips)} clips, in_window={all_in_window}, captions_ok={captions_ok or preview}")
    if status == "FAIL":
        raise HarnessError("Verification failed: captions not burned.")


# ─────────────────────────────────────────────────────────────────────────────
# Stage: audio (mixer generate job — submit/poll)
# ─────────────────────────────────────────────────────────────────────────────
def stage_audio(report: Report, cfg: dict, prompt: str, llm: dict,
                timeout: float, no_presign: bool) -> None:
    section("Stage A — Audio Studio (generate)")
    out_prefix = f"audio/e2e-{uuid.uuid4()}/"
    # Contract mirrors ProcessAudioRequest in apps/mixer/main.py and the
    # 'generate' payload built in inngest/functions.ts::runMixer. Submit/poll,
    # same shape as the downloader: submit -> 202 {call_id}; poll {call_id} ->
    # 202 pending or 200 completed.
    submit_payload = {
        "mode": "generate",
        "out_prefix": out_prefix,
        "prompt": prompt,
        "genre": None,
        "duration_seconds": 20,
        **llm,
    }
    info(f"Prompt: {truncate(prompt, 120)}")
    info(f"out_prefix: {out_prefix}")
    t0 = time.monotonic()

    try:
        status, data, body = http_post_json(
            cfg["process_audio"], submit_payload, bearer=cfg["auth_token"],
            timeout=AUDIO_SUBMIT_TIMEOUT_S,
        )
    except HarnessError as exc:
        fail(str(exc))
        report.stage("audio_generate", "FAIL", time.monotonic() - t0, error=str(exc))
        raise

    if status == 401:
        report.stage("audio_generate", "FAIL", time.monotonic() - t0, error="401 auth")
        raise HarnessError("Mixer rejected the bearer token (PROCESS_VIDEO_ENDPOINT_AUTH).")
    if status != 202 or not data or not data.get("call_id"):
        detail = truncate((data or {}).get("detail", body) if isinstance(data, dict) else body, 500)
        fail(f"Mixer submit returned HTTP {status}: {detail}")
        report.stage("audio_generate", "FAIL", time.monotonic() - t0,
                     error=f"submit HTTP {status}: {detail}")
        raise HarnessError("Mixer job submission failed.")

    call_id = data["call_id"]
    ok(f"Job accepted — call_id {call_id}")
    info(f"Polling until done (timeout {fmt_seconds(timeout)})…")
    time.sleep(AUDIO_INITIAL_WAIT_S)

    try:
        result = _poll_audio(cfg, call_id, timeout)
    except HarnessError as exc:
        # A failure during polling (e.g. the worker 502s) must be recorded as a
        # FAILED stage — otherwise the run has no audio stage at all and the
        # overall status wrongly reports PASS.
        fail(str(exc))
        report.stage("audio_generate", "FAIL", time.monotonic() - t0, error=str(exc))
        raise
    elapsed = time.monotonic() - t0

    s3_key = result.get("s3_key")
    if not s3_key:
        fail(f"Mixer completed without an s3_key: {truncate(json.dumps(result), 300)}")
        report.stage("audio_generate", "FAIL", elapsed, error="no s3_key in result")
        raise HarnessError("Audio verification failed: no output artifact.")

    presign = _s3_presigner(cfg) if (HAS_BOTO3 and not no_presign and cfg["s3_bucket"]) else None
    presigned = presign(s3_key) if presign else None
    ok(f"Audio job completed in {fmt_seconds(elapsed)}")
    ok(f"Output artifact: {s3_key}")
    if result.get("wav_s3_key"):
        info(f"WAV master: {result['wav_s3_key']}")
    if result.get("duration"):
        info(f"Track duration: {result['duration']:.1f}s")
    if result.get("processing_summary"):
        info(f"Summary: {truncate(result['processing_summary'], 200)}")
    if presigned:
        print(f"       {DIM}{presigned}{RESET}")

    report.audio = {
        "s3_key": s3_key,
        "wav_s3_key": result.get("wav_s3_key"),
        "duration": result.get("duration"),
        "title": result.get("title"),
        "presigned_url": presigned,
        "processing_summary": truncate(result.get("processing_summary", ""), 300),
    }
    report.stage("audio_generate", "PASS", elapsed,
                 detail=f"s3_key={s3_key}, duration={result.get('duration')}")


def _poll_audio(cfg: dict, call_id: str, timeout: float) -> dict:
    started = time.monotonic()
    attempt = 0
    while True:
        if time.monotonic() - started > timeout:
            raise HarnessError(f"Mixer job did not finish within {fmt_seconds(timeout)}.")
        attempt += 1
        status, data, body = http_post_json(
            cfg["process_audio"], {"call_id": call_id}, bearer=cfg["auth_token"],
            timeout=AUDIO_POLL_TIMEOUT_S,
        )
        if status == 202:
            delay = min(AUDIO_POLL_MIN_S + (attempt - 1) * 5, AUDIO_POLL_MAX_S)
            elapsed = fmt_seconds(time.monotonic() - started)
            print(f"  {YELLOW}○{RESET} mixing… (elapsed {elapsed}, attempt {attempt})", end="\r")
            time.sleep(delay)
            continue
        print()  # clear \r
        if status != 200 or not data:
            detail = truncate((data or {}).get("detail", body) if isinstance(data, dict) else body, 500)
            raise HarnessError(f"Mixer poll returned HTTP {status}: {detail}")
        return data


# ─────────────────────────────────────────────────────────────────────────────
# S3 presigned URL helper (optional)
# ─────────────────────────────────────────────────────────────────────────────
def _s3_presigner(cfg: dict):
    try:
        client = boto3.client(
            "s3",
            region_name=cfg["aws_region"] or None,
            aws_access_key_id=cfg["aws_key_id"] or None,
            aws_secret_access_key=cfg["aws_secret"] or None,
        )
    except (BotoCoreError, ClientError, ValueError):
        return None

    def _presign(key: str) -> str | None:
        try:
            return client.generate_presigned_url(
                "get_object",
                Params={"Bucket": cfg["s3_bucket"], "Key": key},
                ExpiresIn=3600,
            )
        except (BotoCoreError, ClientError):
            return None

    return _presign


# ─────────────────────────────────────────────────────────────────────────────
# Report writers
# ─────────────────────────────────────────────────────────────────────────────
def write_reports(report: Report) -> Path:
    data = report.to_dict()
    stamp = report.started_utc.strftime("%Y%m%dT%H%M%SZ")
    run_dir = REPORTS_DIR / f"e2e-{stamp}"
    run_dir.mkdir(parents=True, exist_ok=True)
    json_path = run_dir / "report.json"
    json_path.write_text(json.dumps(data, indent=2), encoding="utf-8")
    _write_markdown(data, json_path)
    return json_path


def _status_icon(status: str) -> str:
    return {"PASS": "✅", "FAIL": "❌", "WARN": "⚠️", "SKIP": "⏭️"}.get(status, "•")


def _write_markdown(data: dict, json_path: Path) -> None:
    lines: list[str] = []
    lines.append("# ClipCast E2E Test Report")
    lines.append("")
    lines.append(f"- **Overall:** {_status_icon(data['overall_status'])} "
                 f"**{data['overall_status']}**")
    lines.append(f"- **Run (UTC):** {data['started_at_utc']} → {data['finished_at_utc']}")
    lines.append(f"- **Duration:** {fmt_seconds(data['total_seconds'])}")
    lines.append(f"- **Machine report JSON:** `{json_path}`")
    lines.append("")

    # Environment
    envd = data["environment"]
    lines.append("## Environment")
    lines.append("")
    lines.append("| Key | Value |")
    lines.append("| --- | --- |")
    for k in ("python", "boto3_available", "local_download_endpoint",
              "process_video_endpoint", "process_audio_endpoint",
              "s3_bucket", "aws_region"):
        lines.append(f"| {k} | {envd.get(k, '')} |")
    llm = data["llm"]
    if llm:
        lines.append(f"| llm_provider | {llm.get('provider')} |")
        lines.append(f"| llm_model | {llm.get('model')} |")
        lines.append(f"| llm_effort | {llm.get('effort')} |")
        lines.append(f"| llm_api_key_source | {llm.get('api_key_source')} |")
    lines.append("")

    # Stages
    lines.append("## Stages")
    lines.append("")
    lines.append("| Stage | Status | Time | Detail |")
    lines.append("| --- | --- | --- | --- |")
    for s in data["stages"]:
        detail = s["error"] or s["detail"]
        lines.append(f"| {s['name']} | {_status_icon(s['status'])} {s['status']} | "
                     f"{fmt_seconds(s['seconds'])} | {truncate(detail, 160).replace('|', '/')} |")
    lines.append("")

    # Clips
    if data["clips"]:
        lines.append("## Clips")
        lines.append("")
        lines.append("| # | Title | Duration | In 30-60s | Captions | S3 key |")
        lines.append("| --- | --- | --- | --- | --- | --- |")
        for c in data["clips"]:
            cap = c["captions_burned"]
            cap_txt = "n/a (preview)" if cap is None else ("yes" if cap else "**NO**")
            title = truncate(str(c.get("title") or ""), 40).replace("|", "/")
            lines.append(
                f"| {c['index']+1} | {title} | {c.get('duration')}s | "
                f"{'yes' if c['in_target_window'] else 'no'} | {cap_txt} | "
                f"`{c.get('s3_key')}` |"
            )
        lines.append("")

    # Audio
    if data["audio"]:
        a = data["audio"]
        lines.append("## Audio Studio")
        lines.append("")
        lines.append(f"- **Output:** `{a.get('s3_key')}`")
        if a.get("wav_s3_key"):
            lines.append(f"- **WAV master:** `{a.get('wav_s3_key')}`")
        if a.get("duration"):
            lines.append(f"- **Duration:** {a.get('duration')}s")
        if a.get("presigned_url"):
            lines.append(f"- **Presigned URL (1h):** {a.get('presigned_url')}")
        if a.get("processing_summary"):
            lines.append(f"- **Summary:** {a.get('processing_summary')}")
        lines.append("")

    # Bugs
    lines.append("## Bugs / anomalies")
    lines.append("")
    if data["bugs"]:
        for b in data["bugs"]:
            lines.append(f"- ⚠️ {b}")
    else:
        lines.append("- None found.")
    lines.append("")

    (json_path.parent / "report.md").write_text("\n".join(lines), encoding="utf-8")


# ─────────────────────────────────────────────────────────────────────────────
# CLI + main
# ─────────────────────────────────────────────────────────────────────────────
def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="e2e_full_pipeline.py",
        description="ClipCast end-to-end pipeline harness (clip + audio flows).",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("--url", default=DEFAULT_YOUTUBE_URL,
                        help=f"YouTube URL for the clip flow (default: {DEFAULT_YOUTUBE_URL})")
    parser.add_argument("--mode", default="all", choices=CLIP_MODES,
                        help="Clip selection mode (default: all)")
    parser.add_argument("--preview", action="store_true",
                        help="Fast preview clips (skips ASD + captions).")
    parser.add_argument("--audio", action="store_true",
                        help="Also run an Audio Studio generate job after the clip flow.")
    parser.add_argument("--audio-only", action="store_true",
                        help="Run ONLY the Audio Studio flow (skip the clip flow).")
    parser.add_argument("--audio-prompt", default=DEFAULT_AUDIO_PROMPT,
                        help="Prompt for the --audio generate job.")
    parser.add_argument("--llm-provider", default=env("CLIPCAST_LLM_PROVIDER") or "claude",
                        help="LLM provider for the AI crew (default: claude, or $CLIPCAST_LLM_PROVIDER).")
    parser.add_argument("--s3-key",
                        help="Skip local download; use this existing S3 key for the clip flow.")
    parser.add_argument("--timeout", type=int, default=DEFAULT_PROCESS_TIMEOUT_S,
                        help=f"Per-stage processing timeout in seconds (default: {DEFAULT_PROCESS_TIMEOUT_S}).")
    parser.add_argument("--no-presign", action="store_true",
                        help="Skip generating presigned S3 URLs.")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)

    print(f"\n{BOLD}{'=' * 64}{RESET}")
    print(f"{BOLD}  ClipCast E2E Pipeline Harness{RESET}")
    print(f"{BOLD}{'=' * 64}{RESET}")
    loaded = load_env_file(ENV_PATH)
    if loaded:
        info(f"Loaded {loaded} key(s) from {ENV_PATH}")
    else:
        info(f"No new keys from {ENV_PATH} (missing, or all already in the shell env).")

    run_clip = not args.audio_only
    run_audio = args.audio or args.audio_only
    report = Report(args)

    try:
        cfg = check_config(report, need_clip=run_clip, need_audio=run_audio)
        llm = resolve_llm_config(report, args.llm_provider)

        if run_clip:
            if args.s3_key:
                section("Stage 1 — Local download (SKIPPED — --s3-key provided)")
                s3_key = args.s3_key
                ok(f"Using existing S3 key: {s3_key}")
                report.stage("local_download", "SKIP", 0.0, detail=f"s3_key={s3_key}")
            else:
                s3_key = stage_local_download(report, cfg, args.url)

            result = stage_process_clips(
                report, cfg, s3_key, args.mode, args.preview, llm, float(args.timeout)
            )
            verify_clips(report, cfg, result, args.preview, args.no_presign)

        if run_audio:
            stage_audio(report, cfg, args.audio_prompt, llm, float(args.timeout),
                        args.no_presign)

    except HarnessError as exc:
        # Already logged at the failing stage; keep going to write the report.
        fail(f"Run aborted: {exc}")
    except KeyboardInterrupt:
        print()
        fail("Interrupted by user.")
        report.stage("interrupted", "FAIL", 0.0, error="KeyboardInterrupt")

    # ── Summary + reports ─────────────────────────────────────────────────────
    section("Summary")
    for s in report.stages:
        icon = {"PASS": f"{GREEN}✓{RESET}", "FAIL": f"{RED}✗{RESET}",
                "WARN": f"{YELLOW}!{RESET}", "SKIP": f"{DIM}-{RESET}"}.get(s["status"], "•")
        print(f"  {icon} {s['name']:18} {s['status']:5} {fmt_seconds(s['seconds']):>8}")
    json_path = write_reports(report)
    print()
    ok(f"Machine report:  {json_path}")
    ok(f"Human report:    {json_path.parent / 'report.md'}")
    print()
    if report.overall == "PASS" and report.stages:
        print(f"  {GREEN}{BOLD}E2E HARNESS PASSED ✓{RESET}\n")
        return 0
    print(f"  {RED}{BOLD}E2E HARNESS FAILED ✗{RESET}\n")
    return 1


if __name__ == "__main__":
    sys.exit(main())
