#!/usr/bin/env bash

set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODAL_CLI="$DIR/../../.venv/bin/modal"

if [[ ! -x "$MODAL_CLI" ]]; then
  MODAL_CLI="$(command -v modal || true)"
fi
if [[ -z "$MODAL_CLI" ]]; then
  echo "ERROR: Modal CLI not found. Install it in clipcast-backend/.venv." >&2
  exit 1
fi

echo "==> Deploying clipcast GPU processor"
cd "$DIR"
exec "$MODAL_CLI" deploy main.py
