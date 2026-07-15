#!/usr/bin/env bash
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)/plugin/com.taehyeong.streamdock.claudeusage.sdPlugin"
DEST="$HOME/Library/Application Support/HotSpot/StreamDock/plugins"
mkdir -p "$DEST"
rsync -a --delete "$SRC" "$DEST/"
echo "[installed] $DEST/$(basename "$SRC")"
if pgrep -f "MONSTAR DECK" >/dev/null; then
  echo "[restart] MONSTAR DECK 재시작 중…"
  killall "MONSTAR DECK" 2>/dev/null || true; sleep 1
fi
open -a "MONSTAR DECK" 2>/dev/null || echo "MONSTAR DECK 수동 실행 필요"
