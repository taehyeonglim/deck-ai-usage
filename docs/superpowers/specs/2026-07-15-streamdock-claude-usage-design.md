# Stream Dock(MONSTAR DECK) Claude 사용량 게이지 — 설계 스펙

- **작성일**: 2026-07-15
- **상태**: 설계 승인됨 (구현 계획 대기)
- **목표**: MONSTAR DECK 물리 패널의 버튼 하나에 Claude Code 남은 사용량을 실시간 자동 갱신 게이지 아이콘으로 표시한다.

---

## 1. 배경 / 확정된 기술 사실 (실측 grounding)

이 스펙의 모든 판단은 로컬 실측으로 확인됨.

| 사실 | 근거 |
|------|------|
| MONSTAR DECK = **Stream Dock**(Mirabox/Hotspot) 리브랜딩 | 번들 플러그인이 전부 `com.hotspot.streamdock.*`, `com.mirabox.streamdock.*` |
| 버튼 동작은 **Elgato Stream Deck SDK**(SDKVersion 1) 포맷 | `.sdPlugin` + `manifest.json` + WebSocket. `connectElgatoStreamDeckSocket(port,uuid,event,info)` → `ws://127.0.0.1:<port>` |
| 커스텀 플러그인 설치 경로(쓰기 가능) | `~/Library/Application Support/HotSpot/StreamDock/plugins/` — 이미 `weather`/`time`/`memo` 커스텀 플러그인 상주 |
| 플러그인 런타임은 **순수 브라우저 JS(CEF/QCefView)** — `require`/`fs` 없음 | `weather/plugin/index.js`, `static/plugin.js`, `static/action.js` 전수 확인. `autofile.js`의 `require('fs-extra')`는 **빌드 스크립트**일 뿐 런타임 아님 |
| ⇒ 플러그인은 로컬 파일(`~/NERV/...`)을 **직접 못 읽음** → 데이터 브리지 필요 | 위와 동일 |
| `setImage` 전송 포맷 | `{event:"setImage", context, payload:{target:0, image:<canvas.toDataURL("image/png")>}}` (`static/plugin.js:74-100`) |
| `setTitle` 전송 포맷 | `{event:"setTitle", context, payload:{target:0, title}}` |
| 주기 재도색은 **Web Worker 타이머**로 구현하는 게 관례 | `time/interval.js` (postMessage 기반 setInterval) |
| 사용량 데이터 소스가 **이미 실시간 존재** | `~/NERV/Agents/Lab Director/agent-monitor/output/token_status_data.js`, 30초 주기 갱신, 상시 launchd KeepAlive |
| 소스 필드 | `.claude.{available, pct_5h, pct_7d, reset_5h, reset_7d, pct_source, pct_stale_min}` — `source:"session"`(429 면역 로컬 추정치) |
| 소스 write 지점(라이터 폴딩 대상) | `Agents/Lab Director/project-dashboard/token_status_writer.py` (daemon이 30초마다 호출, `monitor_daemon.py:347`) |

**"남은 사용량" 정의**: 소스의 `pct_*`는 *사용된* %이므로 **남은 % = `100 - pct`**. 예: `pct_7d:24` → 주간 남음 76%.

---

## 2. 아키텍처

```
[agent-monitor 데몬]  ──30초마다──▶  token_status_writer.py  ──쓰기──▶  token_status_data.js
                                            │ (여기에 write 한 번 추가)
                                            ▼
                    <plugin>/data/usage.json  (남은% 변환 + stale 플래그, 원자적 write)
                                            │
                     fetch('./data/usage.json')  (동일 출처, 30초 주기)
                                            ▼
                         [.sdPlugin (CEF 브라우저 JS)]  ── 캔버스 링 게이지 렌더 ──▶  setImage(base64) ──ws──▶ 덱 버튼
```

구성 요소는 **3개**: (A) 데이터 라이터, (B) 플러그인, (C) 설치 스크립트.

---

## 3. 구성 요소 A — 데이터 라이터 (agent-monitor 폴딩)

**원칙**: 새 프로세스/새 launchd 잡 0. 이미 30초마다 도는 `token_status_writer.py`가 `token_status_data.js`를 쓴 **직후**, 압축 JSON을 플러그인 폴더에도 원자적으로 쓴다.

**출력 스키마** `<plugin>/data/usage.json`:
```json
{
  "rem_5h": 95,
  "rem_7d": 76,
  "reset_5h": "07/16 00:00",
  "reset_7d": "07/20 19:00",
  "stale": false,
  "available": true,
  "ts": 1752620472
}
```

**변환 규칙**:
- `rem_5h = 100 - claude.pct_5h`, `rem_7d = 100 - claude.pct_7d` (0~100 clamp)
- `reset_*`는 `"MM/DD HH:MM"` 부분만(뒤 " KST" 절삭) — 덱 버튼 폭 제약
- `stale = (claude.pct_source == "cache" and claude.pct_stale_min >= 15)` — NERV statusline의 `~` 마커와 동일 기준
- `available = claude.available` (false면 플러그인이 "—" 표시)
- `ts` = 유닉스초 (플러그인이 파일 자체 신선도 2차 판정에 사용)

**쓰기 방식**: `tmp write + os.replace`(원자적). 대상 경로는 `token_status_writer.py`에 상수/환경변수(`STREAMDOCK_USAGE_JSON`)로 주입, 미설정 시 write 생략(NERV 단독 실행 시 무영향 = fail-safe).

**blast radius 최소화**: 기존 로직 무변경, try/except로 감싸 이 write 실패가 데몬 본 기능에 전파되지 않게. NERV worktree 규율(`~/NERV-wt/<task>`)로 반영.

---

## 4. 구성 요소 B — 플러그인 `.sdPlugin`

**식별자**: `com.taehyeong.streamdock.claudeusage.sdPlugin` / 액션 UUID `com.taehyeong.streamdock.claudeusage.gauge`

**파일 레이아웃** (time/weather 스켈레톤 복제):
```
com.taehyeong.streamdock.claudeusage.sdPlugin/
├── manifest.json
├── plugin/
│   ├── index.html        # CodePath. 소켓 연결 + 타이머 + 렌더
│   ├── index.js          # 로직
│   └── timer.worker.js   # time/interval.js 패턴
├── data/
│   └── usage.json        # 라이터가 채움 (초기값 placeholder 동봉)
├── images/
│   └── cate.png, icon.png, defaultImage.png
├── propertyInspector/
│   └── index.html        # 최소 (소스 상태/버전 안내만, 설정 없음)
└── en.json, ko.json
```

**manifest 핵심**:
```json
{
  "Actions": [{
    "UUID": "com.taehyeong.streamdock.claudeusage.gauge",
    "Name": "Claude Usage",
    "States": [{ "Image": "images/defaultImage", "TitleAlignment": "bottom" }],
    "Controllers": ["Keypad"],
    "UserTitleEnabled": false,
    "SupportedInMultiActions": false,
    "PropertyInspectorPath": "propertyInspector/index.html"
  }],
  "SDKVersion": 1,
  "CodePath": "plugin/index.html",
  "Category": "Claude Usage",
  "OS": [{ "Platform": "mac", "MinimumVersion": "10.11" }],
  "Software": { "MinimumVersion": "2.9" }
}
```

**런타임 로직** (`plugin/index.js`):
1. `connectElgatoStreamDeckSocket(port,uuid,event,info)` → `ws://127.0.0.1:<port>` 열고 등록 `{uuid,event}` 전송 (weather `static/plugin.js:142-149` 그대로).
2. `willAppear` 수신 시 해당 `context`를 활성 집합에 저장, `willDisappear`에 제거.
3. Web Worker 타이머 30초(초회 즉시 1회) → 활성 context마다 렌더+`setImage`.
4. `fetch('./data/usage.json?ts=' + Date.now())`(캐시 무효화) → 파싱.
5. 캔버스 렌더 → `canvas.toDataURL("image/png")` → `setImage(context, dataURL, isGif=true)`(이미 dataURL이므로 재-Image 로드 경로 회피).

**렌더 사양** (캔버스 144×144, 버튼에서 축소):
- **주간(7d) 큰 링**: 외곽 원형 게이지, 남은 비율만큼 채움(12시 시작, 시계방향). 중앙에 `76%`(굵게).
- **5h 세션**: 상단 구석 소형 텍스트 `5h 95%`.
- **하단 라벨**: `주간남음`.
- **색상 임계값**(남은 % 기준, 주간 링 색):
  - `> 50%` 초록 `#3FB950`
  - `20–50%` 주황 `#D29922`
  - `< 20%` 빨강 `#F85149`
- **stale 처리**: `stale==true`면 링을 회색조로 흐리게 + 우상단 작은 점(◦). "얼어붙은 데몬이 95% 여유로 오독"되는 것 방지.
- **available==false**: 링 비우고 중앙 `—`.
- **fetch 실패/파일 없음**: 직전 값 유지 + stale 표기(첫 실행이면 `—`).

---

## 5. 구성 요소 C — 설치 스크립트 (`install.sh`, 멱등)

1. 플러그인 폴더를 `~/Library/Application Support/HotSpot/StreamDock/plugins/`로 rsync/cp (기존 있으면 덮어씀).
2. `data/usage.json` placeholder 보존(라이터가 아직 안 돌았을 때 대비).
3. MONSTAR DECK 재시작 안내(또는 `killall "MONSTAR DECK" && open`).
4. **앱 재설치 지속성 노트**: `.pkg` 재설치가 커스텀 플러그인을 지울 수 있음 → `install.sh` 재실행 한 번으로 복구. README에 명시.

---

## 6. 핵심 리스크 / 결정 지점

**R1 — 로컬 fetch 가능 여부 (최우선 검증)**: `fetch('./data/usage.json')`이 CEF에서 통하는지 미확정. 플러그인 페이지가 `file://`로 로드되면 크로미움이 same-dir라도 로컬 fetch를 막을 수 있음. weather의 원격 HTTPS fetch는 이 케이스를 증명하지 못함.
- **구현 1단계에서 실물 렌더러로 즉시 검증**(플러그인 설치 → 콘솔 로그 관찰).
- **통과 시**: 그대로 진행.
- **막힐 시 폴백**: agent-monitor가 `127.0.0.1:<port>/claude-usage`로 usage JSON을 서빙(초경량, 단일 클라이언트), 플러그인은 원격 fetch 경로 사용. 새 상시 포트 1개 비용은 있으나 weather가 이미 검증한 경로.

**R2 — 새 플러그인 인식**: 덱이 재시작 없이 새 `.sdPlugin`을 인식하는지. → 설치 스크립트가 재시작 처리.

**R3 — 키 이미지 vs 타이틀 렌더 충돌**: `setImage`가 소프트 타이틀 위에 그려지는지. → `UserTitleEnabled:false` + 이미지에 텍스트 직접 렌더로 회피(주간% 등 전부 캔버스에 그림).

**R4 — 캔버스 해상도**: 키 물리 해상도 미상(72~144px 추정). 144로 렌더 후 축소, 실측 후 조정.

---

## 7. 검증 계획 (render/executable → 실물 관찰 필수)

1. 라이터 단위: `token_status_writer.py`에 `STREAMDOCK_USAGE_JSON` 주입 → 1회 실행 → usage.json 값/원자성 확인.
2. 플러그인 설치 → MONSTAR DECK에서 "Claude Usage" 액션을 키에 배치 → **버튼에 주간 76% 링 + 5h 95% 표시 관찰**.
3. 라이브 갱신: `token_status_data.js` 변하면 30초 내 버튼 반영 관찰.
4. stale 경로: usage.json `stale:true` 강제 → 링 흐려짐 관찰.
5. available:false, fetch 실패 경로 각각 관찰.

---

## 8. 범위 밖 (YAGNI)

- 클릭 동작(누르면 상세) — 이번엔 순수 표시만.
- Property Inspector 설정 UI(소스 경로/주기 조절) — 하드코딩/env로 충분.
- Codex·Gemini 사용량(소스엔 있음) — 향후 별도 버튼으로 확장 가능, 이번 범위 아님.
- Windows 지원 — mac 전용(경로/재시작이 mac 기준).
- 비용($)·토큰수 표시 — 소스엔 있으나 이번은 남은 % 게이지에 집중.

---

## 9. 프로젝트 배치

- **독립 프로젝트** `~/streamdock-claude-usage/` (자체 git). 플러그인 소스 + 설치 스크립트 + 이 스펙 + README.
- NERV 접점은 §3 라이터 몇 줄뿐 — NERV worktree(`~/NERV-wt/streamdock-usage`)로 별도 반영, 이 저장소는 NERV 감사 파이프라인과 분리.
