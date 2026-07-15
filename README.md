# streamdock-claude-usage
MONSTAR DECK(Stream Dock)에 Claude Code 남은 사용량을 실시간 게이지로.

## 설치
    python3 scaffold_assets.py && bash install.sh
MONSTAR DECK에서 "Claude Usage" 액션을 키에 배치.

## 데이터 연동
agent-monitor(NERV)가 30초마다 usage.json을 갱신. 연동은 launchd env
STREAMDOCK_USAGE_JSON 참조 (Task 5).

## 앱 재설치 후
`.pkg` 재설치가 커스텀 플러그인을 지울 수 있음 → `bash install.sh` 재실행.

## 테스트
    node --test tests/helpers.test.js
    python3 -m pytest tests/ -q
