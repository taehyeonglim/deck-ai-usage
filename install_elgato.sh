#!/usr/bin/env bash
# EXPERIMENTAL: Elgato Stream Deck installer (only Stream Dock is verified on real hardware).
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)/plugin/com.taehyeong.streamdock.claudeusage.sdPlugin"
DEST="$HOME/Library/Application Support/com.elgato.StreamDeck/Plugins"
mkdir -p "$DEST"
rsync -a --delete "$SRC" "$DEST/"
# Elgato requires SDKVersion 2 — swap in the Elgato manifest variant.
cp "$DEST/$(basename "$SRC")/manifest.elgato.json" "$DEST/$(basename "$SRC")/manifest.json"
echo "[installed] $DEST/$(basename "$SRC")"
if pgrep -x "Stream Deck" >/dev/null; then
  echo "[restart] Stream Deck 재시작 중…"
  killall "Stream Deck" 2>/dev/null || true; sleep 1
fi
open -a "Elgato Stream Deck" 2>/dev/null || open -a "Stream Deck" 2>/dev/null \
  || echo "Stream Deck 앱을 수동으로 실행하세요"
