#!/usr/bin/env bash
#
# start.sh — Launch the ClipCast local dev stack.
#
# Heavy GPU/AI processing runs on Modal (the cloud backend is already deployed),
# so this script only starts the LIGHTWEIGHT local processes — it will not hang
# your machine. The backend is NEVER run locally.
#   1. Next.js frontend      -> http://localhost:3000
#   2. Inngest dev worker     -> http://localhost:8288
#   3. Stripe webhook listener (optional — only if the `stripe` CLI is installed)
#
# Usage:
#   ./start.sh            # start frontend + inngest + stripe listener
#   ./start.sh --deploy   # (re)deploy the Modal backend to the cloud first, then start
#
# Press Ctrl+C to stop everything cleanly.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND="$ROOT/clipcast-frontend"
BACKEND="$ROOT/clipcast-backend"

# Keep local orchestration bounded. Video/AI work belongs on Modal; the local
# Node processes should never need multi-gigabyte heaps for normal development.
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=3072}"
export NEXT_TELEMETRY_DISABLED=1
export MALLOC_ARENA_MAX=2

# ── Pre-flight checks ─────────────────────────────────────────────────────────
if [[ ! -f "$ROOT/.env" ]]; then
  echo "ERROR: $ROOT/.env not found. Copy .env.example to .env and fill it in." >&2
  exit 1
fi
node_is_supported() {
  command -v node >/dev/null 2>&1 && node -e '
    const [major, minor] = process.versions.node.split(".").map(Number);
    process.exit(major > 20 || (major === 20 && minor >= 9) ? 0 : 1);
  '
}

# Ubuntu's /usr/bin/node is currently v18 on this machine. Prefer the installed
# NVM Node 22 runtime required by Next.js 16.
if ! node_is_supported && [[ -s "$HOME/.nvm/nvm.sh" ]]; then
  # shellcheck disable=SC1090
  source "$HOME/.nvm/nvm.sh"
  nvm use --silent 22 >/dev/null
fi

if ! node_is_supported; then
  echo "ERROR: Node.js 20.9+ is required (Node 22 is recommended)." >&2
  echo "       Install it with: nvm install 22" >&2
  exit 1
fi
command -v npm >/dev/null 2>&1 || { echo "ERROR: npm is not installed." >&2; exit 1; }

# Avoid stacking duplicate dev servers, which is a common cause of high CPU and
# memory use after a previous terminal was closed without stopping its children.
for port in 3000 8288; do
  if ss -ltn "sport = :$port" 2>/dev/null | grep -q LISTEN; then
    echo "ERROR: Port $port is already in use. Stop the existing ClipCast process first." >&2
    exit 1
  fi
done

if ! grep -Eq '^PROCESS_VIDEO_ENDPOINT="?https://[^ ]+\.modal\.run' "$ROOT/.env"; then
  echo "WARNING: PROCESS_VIDEO_ENDPOINT does not look like a Modal endpoint." >&2
  echo "         Heavy jobs may not be isolated from this machine." >&2
fi

# ── Optional: (re)deploy the Modal backend ────────────────────────────────────
if [[ "${1:-}" == "--deploy" ]]; then
  echo "==> Deploying backend to Modal (cloud build — won't load your CPU/GPU)..."
  if [[ -f "$BACKEND/.venv/bin/activate" ]]; then
    # shellcheck disable=SC1091
    source "$BACKEND/.venv/bin/activate"
  fi
  "$BACKEND/deploy.sh" all
fi

# ── Install frontend deps if missing ──────────────────────────────────────────
if [[ ! -d "$FRONTEND/node_modules" ]]; then
  echo "==> Installing frontend dependencies (first run only)..."
  ( cd "$FRONTEND" && npm install )
fi

# ── Start the local processes ─────────────────────────────────────────────────
pids=()
required_pids=()
cleanup() {
  trap - INT TERM EXIT
  echo ""
  echo "==> Stopping ClipCast..."
  for pid in "${pids[@]}"; do
    # Every service starts in its own session/process group. Terminating the
    # group also stops npm's child processes instead of leaving orphans behind.
    kill -TERM -- "-$pid" 2>/dev/null || true
  done
  for pid in "${pids[@]}"; do
    wait "$pid" 2>/dev/null || true
  done
}
trap cleanup INT TERM EXIT

start_service() {
  local working_dir="$1"
  shift
  setsid bash -c 'cd "$1" && shift && exec "$@"' _ "$working_dir" "$@" &
  pids+=("$!")
}

echo "==> Clearing stuck local jobs (if any)..."
(cd "$FRONTEND" && npx -y tsx prisma/reset-stuck-jobs.ts || true)

echo "==> Starting Inngest dev worker  -> http://localhost:8288"
start_service "$FRONTEND" npm run inngest-dev
required_pids+=("${pids[-1]}")

echo "==> Starting Next.js frontend    -> http://localhost:3000"
start_service "$FRONTEND" npm run dev
required_pids+=("${pids[-1]}")

# Stripe webhook forwarder — needed for credit-purchase webhooks in local dev.
# Optional: only starts if the Stripe CLI is installed and logged in.
if command -v stripe >/dev/null 2>&1; then
  echo "==> Starting Stripe webhook listener -> localhost:3000/api/stripe/webhook"
  start_service "$ROOT" stripe listen --forward-to localhost:3000/api/stripe/webhook
else
  echo "==> Skipping Stripe listener ('stripe' CLI not found)."
  echo "    Install it (https://stripe.com/docs/stripe-cli) + run 'stripe login'"
  echo "    to test credit purchases locally."
fi

cat <<'BANNER'

──────────────────────────────────────────────
  ClipCast is starting up (local = lightweight only):
    Frontend : http://localhost:3000
    Inngest  : http://localhost:8288
    Stripe   : forwarding webhooks (if CLI installed)
    Backend  : Modal cloud (already deployed) —
               ALL heavy GPU/AI work runs there, never locally.

  Crew debug / observability (see how the AI agents decided each job):
    Admin    : http://localhost:3000/admin/jobs   (click "Inspect" on a job:
               who/what/why per step, real model vs fallback, errors)
    User view: http://localhost:3000/dashboard/production/<jobId>
    Langfuse : http://localhost:3001  (only if you ran
               docker-compose.langfuse.yml; else use the free cloud.langfuse.com)

  Press Ctrl+C to stop everything.
──────────────────────────────────────────────

BANNER

# Stop the whole stack if any required service exits unexpectedly.
wait -n "${required_pids[@]}"
