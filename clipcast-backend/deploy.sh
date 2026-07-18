#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="${1:-all}"

case "$TARGET" in
  processor)
    "$ROOT/apps/processor/deploy.sh"
    ;;
  downloader)
    "$ROOT/apps/downloader/deploy.sh"
    ;;
  mixer)
    "$ROOT/apps/mixer/deploy.sh"
    ;;
  composer)
    "$ROOT/apps/composer/deploy.sh"
    ;;
  all)
    # composer first — the mixer calls it by name (modal.Cls.from_name), so it
    # should exist before a mixer job runs.
    "$ROOT/apps/composer/deploy.sh"
    "$ROOT/apps/mixer/deploy.sh"
    "$ROOT/apps/processor/deploy.sh"
    "$ROOT/apps/downloader/deploy.sh"
    ;;
  *)
    echo "Usage: $0 {all|processor|downloader|mixer|composer}" >&2
    exit 2
    ;;
esac
