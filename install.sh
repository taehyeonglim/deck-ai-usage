#!/usr/bin/env bash
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)/plugin/com.taehyeong.streamdock.claudeusage.sdPlugin"
DEST="$HOME/Library/Application Support/HotSpot/StreamDock/plugins"
mkdir -p "$DEST"
# data/ 는 제외하고 동기화한다 — repo 의 all-null usage.json 이 실데이터를 덮어쓰면
# 다음 writer 틱 전까지 게이지가 비고, 재설치 안내(README)가 곧 데이터 손실이 된다.
rsync -a --delete --exclude "data/" "$SRC" "$DEST/"
DATA="$DEST/$(basename "$SRC")/plugin/data"
mkdir -p "$DATA"
[ -f "$DATA/usage.json" ] || cp "$SRC/plugin/data/usage.json" "$DATA/usage.json"   # 최초 설치 시드
echo "[installed] $DEST/$(basename "$SRC")"
if pgrep -f "MONSTAR DECK" >/dev/null; then
  echo "[restart] MONSTAR DECK 재시작 중…"
  killall "MONSTAR DECK" 2>/dev/null || true; sleep 1
fi
open -a "MONSTAR DECK" 2>/dev/null || echo "MONSTAR DECK 수동 실행 필요"
