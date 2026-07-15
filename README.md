# streamdock-claude-usage
MONSTAR DECK(Stream Dock)에 AI 사용량(Claude / Codex / Gemini)을 실시간 게이지로.

## 액션 5개 (Category: AI Usage)
각 버튼이 한 지표 전담 — 풀사이즈 링 + 중앙 남은% + 라벨 + 리셋시각:
- **Claude 5h** / **Claude 주간** (7일)
- **Codex 5h** / **Codex 주간** (7일)
- **Gemini** (단일 지표)

링 색은 남은%(초록>50 / 주황≥20 / 빨강<20), 프로바이더는 라벨·액센트로 구분.

## 설치
    python3 scaffold_assets.py && bash install.sh
MONSTAR DECK에서 원하는 액션(Claude 5h 등)을 키에 배치.

## 데이터 연동
NERV agent-monitor 데몬이 `token_status_writer.py`(30초 주기)에서 usage.json을
플러그인 폴더에 직접 기록한다. 기본 대상 경로가 이 플러그인 위치로 지정돼 있어
**launchd 편집·env 설정 불필요(zero-config)**. 필요 시 `STREAMDOCK_USAGE_JSON`
환경변수로 경로를 재정의할 수 있다(선택). 자동 30초 갱신은 이 연동이 NERV
main에 병합돼 라이브 데몬이 새 코드를 실행할 때 발효되며, 미병합 상태에선
`token_status_writer.py`를 수동 실행할 때만 갱신된다.

## 앱 재설치 후
`.pkg` 재설치가 커스텀 플러그인을 지울 수 있음 → `bash install.sh` 재실행.

## 테스트
    node --test tests/helpers.test.js
    python3 -m pytest tests/ -q
