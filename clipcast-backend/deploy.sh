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
  all)
    "$ROOT/apps/processor/deploy.sh"
    "$ROOT/apps/downloader/deploy.sh"
    ;;
  *)
    echo "Usage: $0 {all|processor|downloader}" >&2
    exit 2
    ;;
esac
