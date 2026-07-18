"""
ClipCast — Modal secret setup helper.

Creates (or overwrites, with --force) the persistent `clipcast-secret` that the
deployed backend reads at runtime. Values are pulled from the project-root .env,
so new contributors can set up the Modal secret in one command instead of
copy-pasting keys into the Modal dashboard by hand.

Usage (from anywhere):
    python clipcast-backend/scripts/setup_modal_secret.py

Then deploy:
    clipcast-backend/deploy.sh all

Paths are resolved relative to this file, so the current working directory does
not matter.
"""

import subprocess
import sys
from pathlib import Path

from dotenv import dotenv_values

# scripts/ -> clipcast-backend/ -> repo root
REPO_ROOT = Path(__file__).resolve().parents[2]
ENV_PATH = REPO_ROOT / ".env"

# Keys the deployed services under apps/ actually read via os.environ.
REQUIRED_KEYS = [
    "GEMINI_API_KEY",
    "PROCESS_VIDEO_ENDPOINT_AUTH",  # bearer token checked by the endpoint
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_REGION",
    "S3_BUCKET_NAME",
]
# Optional keys — included only if set. YT_DLP_PROXY is a residential proxy URL
# that enables the (best-effort) YouTube-URL download path. DEEPSEEK_API_KEY and
# ANTHROPIC_API_KEY enable the DeepSeek / Claude LLM providers for the AI crew
# (Gemini above is the always-required baseline); LANGFUSE_* enable the optional
# agent-trace dashboard (docs/18).
OPTIONAL_KEYS = [
    "YT_DLP_PROXY",
    "DEEPSEEK_API_KEY",
    "ANTHROPIC_API_KEY",
    "LANGFUSE_PUBLIC_KEY",
    "LANGFUSE_SECRET_KEY",
    "LANGFUSE_HOST",
]


def main() -> int:
    if not ENV_PATH.exists():
        print(f"ERROR: {ENV_PATH} not found. Copy .env.example to .env first.", file=sys.stderr)
        return 1

    env = dotenv_values(ENV_PATH)
    pairs: dict[str, str] = {}

    missing = [k for k in REQUIRED_KEYS if not env.get(k)]
    if missing:
        print(f"ERROR: missing/empty in {ENV_PATH}: {', '.join(missing)}", file=sys.stderr)
        return 1
    for k in REQUIRED_KEYS:
        pairs[k] = env[k]
    for k in OPTIONAL_KEYS:
        if env.get(k):
            pairs[k] = env[k]

    print(f"Keys -> clipcast-secret: {', '.join(sorted(pairs))}")

    cmd = ["modal", "secret", "create", "clipcast-secret", "--force"]
    cmd += [f"{k}={v}" for k, v in pairs.items()]
    return subprocess.run(cmd).returncode


if __name__ == "__main__":
    raise SystemExit(main())
