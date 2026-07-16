#!/usr/bin/env bash
# EXPERIMENTAL: Elgato Stream Deck installer (only Stream Dock is verified on real hardware).
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)/plugin/com.taehyeong.streamdock.claudeusage.sdPlugin"
DEST="$HOME/Library/Application Support/com.elgato.StreamDeck/Plugins"
mkdir -p "$DEST"
# data/ 는 제외 — repo 의 all-null usage.json 이 실데이터를 덮어쓰지 않게 한다.
rsync -a --delete --exclude "data/" "$SRC" "$DEST/"
DATA="$DEST/$(basename "$SRC")/plugin/data"
mkdir -p "$DATA"
[ -f "$DATA/usage.json" ] || cp "$SRC/plugin/data/usage.json" "$DATA/usage.json"   # 최초 설치 시드
# Elgato requires SDKVersion 2 — swap in the Elgato manifest variant.
cp "$DEST/$(basename "$SRC")/manifest.elgato.json" "$DEST/$(basename "$SRC")/manifest.json"
echo "[installed] $DEST/$(basename "$SRC")"
if pgrep -x "Stream Deck" >/dev/null; then
  echo "[restart] Stream Deck 재시작 중…"
  killall "Stream Deck" 2>/dev/null || true; sleep 1
fi
open -a "Elgato Stream Deck" 2>/dev/null || open -a "Stream Deck" 2>/dev/null \
  || echo "Stream Deck 앱을 수동으로 실행하세요"
