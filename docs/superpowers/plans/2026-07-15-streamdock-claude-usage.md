# Stream Dock Claude 사용량 게이지 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** MONSTAR DECK(=Stream Dock) 버튼 하나에 Claude Code 남은 사용량(주간 링 + 5h 구석 숫자)을 30초 주기로 자동 갱신하는 게이지 아이콘을 띄운다.

**Architecture:** 상시 도는 agent-monitor 데몬이 남은%를 담은 `usage.json`을 플러그인 폴더에 원자적으로 쓰고, CEF 브라우저 JS 플러그인이 그 파일을 `fetch` → 캔버스 링을 그려 Elgato SDK `setImage`로 버튼에 push한다. 플러그인은 읽기만 하므로 계정 rate limit/429 무관.

**Tech Stack:** Elgato Stream Deck SDK v1 (WebSocket, `.sdPlugin`), 순수 브라우저 JS + Canvas 2D (CEF/QCefView), Python 3(stdlib) 라이터, node --test / pytest.

## Global Constraints

- 플러그인 런타임은 **순수 브라우저 JS** — `require`/`fs`/`process` 사용 금지 (CEF에 Node 통합 없음, 실측 확인).
- SDK 프로토콜은 Elgato v1: 연결 `ws://127.0.0.1:<port>`, 등록 `{uuid, event:<registerEvent>}`, `setImage` payload `{target:0, image:<PNG dataURL>}`, `setTitle` payload `{target:0, title}`.
- 플러그인 설치 경로: `~/Library/Application Support/HotSpot/StreamDock/plugins/`.
- 플러그인 ID: `com.taehyeong.streamdock.claudeusage.sdPlugin`, 액션 UUID: `com.taehyeong.streamdock.claudeusage.gauge`.
- **남은 % = `100 - pct`** (0~100 clamp). 소스 `pct_*`는 사용된 %.
- 데이터 소스: `~/NERV/Agents/Lab Director/agent-monitor/output/token_status_data.js`, 필드 `.claude.{available,pct_5h,pct_7d,reset_5h,reset_7d,pct_source,pct_stale_min}`.
- stale 기준: `pct_source=="cache" && pct_stale_min>=15` (statusline `~` 마커와 동일).
- 색상: 남은% `>50` 초록 `#3FB950` / `>=20` 주황 `#D29922` / else 빨강 `#F85149`. 배경 `#0D1117`.
- 캔버스 렌더 해상도 144×144 (@2x, 덱이 축소).
- 절대 경로 하드코딩 금지(특히 NERV 측): 경로는 env(`STREAMDOCK_USAGE_JSON`)로 주입, 미설정 시 no-op(fail-safe).
- NERV 코드 수정은 `~/NERV-wt/streamdock-usage` worktree에서만 (NERV 불변식: 메인 클론은 main에만 커밋).

---

## File Structure

```
~/streamdock-claude-usage/
├── plugin/com.taehyeong.streamdock.claudeusage.sdPlugin/
│   ├── manifest.json                 # 액션 정의, CodePath
│   ├── plugin/
│   │   ├── index.html                # CodePath 진입 — helpers.js/index.js 로드
│   │   ├── helpers.js                # 순수 함수(테스트 대상): ringColor/isStaleData
│   │   ├── index.js                  # SDK 연결 + 타이머 + fetch + 캔버스 렌더 + setImage
│   │   ├── timer.worker.js           # 30초 반복 (time/interval.js 패턴)
│   │   └── data/usage.json           # 라이터가 채움 — index.html과 같은 트리(상대 fetch 정합)
│   ├── images/{cate,icon,defaultImage}.png
│   ├── propertyInspector/index.html  # 최소 안내 (설정 없음)
│   └── {en,ko}.json
├── writer/
│   ├── usage_payload.py              # 순수 transform: build_payload()
│   └── write_usage.py                # CLI: token_status_data.js → usage.json (원자적)
├── tests/
│   ├── test_usage_payload.py         # pytest
│   └── helpers.test.js               # node --test
├── scaffold_assets.py                # 플레이스홀더 PNG 생성 (stdlib)
├── install.sh                        # 멱등 설치 + 덱 재시작
├── README.md
└── docs/superpowers/{specs,plans}/…
```

---

### Task 1: 플러그인 스켈레톤 + SDK 루프 + R1(로컬 fetch) 검증 게이트

가장 큰 리스크(R1: CEF에서 `fetch('./data/usage.json')`이 통하는가)를 **여기서 즉시 실물 검증**한다. 스켈레톤이 (a) 로드되고 (b) 로컬 fetch 성공하고 (c) setImage로 그린다는 걸 한 번에 증명.

**Files:**
- Create: `plugin/com.taehyeong.streamdock.claudeusage.sdPlugin/manifest.json`
- Create: `plugin/com.taehyeong.streamdock.claudeusage.sdPlugin/plugin/index.html`
- Create: `plugin/com.taehyeong.streamdock.claudeusage.sdPlugin/plugin/index.js`
- Create: `plugin/com.taehyeong.streamdock.claudeusage.sdPlugin/plugin/data/usage.json`
- Create: `scaffold_assets.py`
- Create: `install.sh`

**Interfaces:**
- Produces: 전역 `connectElgatoStreamDeckSocket(port, uuid, registerEvent, info)` (덱이 호출), `plugin/data/usage.json` 스키마 `{rem_5h,rem_7d,reset_5h,reset_7d,stale,available,ts}`.

- [ ] **Step 1: 플레이스홀더 PNG 생성기 작성** — `scaffold_assets.py`

```python
#!/usr/bin/env python3
"""플러그인 이미지 플레이스홀더 생성 (stdlib만). setImage가 런타임에 덮으므로 단색이면 충분."""
import zlib, struct, os, sys

def solid_png(path, w, h, rgb=(13, 17, 23)):
    def chunk(tag, data):
        body = tag + data
        return struct.pack('>I', len(data)) + body + struct.pack('>I', zlib.crc32(body) & 0xffffffff)
    raw = b''.join(b'\x00' + bytes(rgb) * w for _ in range(h))
    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(raw, 9))
    png += chunk(b'IEND', b'')
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'wb') as f:
        f.write(png)

if __name__ == '__main__':
    base = sys.argv[1] if len(sys.argv) > 1 else \
        'plugin/com.taehyeong.streamdock.claudeusage.sdPlugin/images'
    for name in ('cate', 'icon', 'defaultImage'):
        solid_png(os.path.join(base, f'{name}.png'), 144, 144)
    print('assets written to', base)
```

- [ ] **Step 2: 이미지 생성 실행**

Run: `cd ~/streamdock-claude-usage && python3 scaffold_assets.py`
Expected: `assets written to …/images`, `images/{cate,icon,defaultImage}.png` 3개 생성 (각각 유효 PNG).

- [ ] **Step 3: manifest.json 작성**

```json
{
  "Actions": [
    {
      "UUID": "com.taehyeong.streamdock.claudeusage.gauge",
      "Icon": "images/icon",
      "Name": "Claude Usage",
      "Tooltip": "Claude Code 남은 사용량 (주간 링 + 5h)",
      "States": [{ "Image": "images/defaultImage", "TitleAlignment": "bottom" }],
      "Controllers": ["Keypad"],
      "UserTitleEnabled": false,
      "SupportedInMultiActions": false
    }
  ],
  "SDKVersion": 1,
  "CodePath": "plugin/index.html",
  "Name": "Claude Usage",
  "Icon": "images/cate",
  "Category": "Claude Usage",
  "CategoryIcon": "images/cate",
  "Description": "Displays remaining Claude Code usage as a live gauge.",
  "Author": "taehyeong",
  "Version": "0.1.0",
  "OS": [{ "Platform": "mac", "MinimumVersion": "10.11" }],
  "Software": { "MinimumVersion": "2.9" }
}
```

- [ ] **Step 4: placeholder usage.json 작성** — `plugin/data/usage.json` (index.html과 같은 트리 → 상대 fetch `./data/usage.json` 정합)

```json
{ "rem_5h": 95, "rem_7d": 76, "reset_5h": "07/16 00:00", "reset_7d": "07/20 19:00", "stale": false, "available": true, "ts": 0 }
```

- [ ] **Step 5: index.html 작성**

```html
<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body><canvas id="c" width="144" height="144" style="display:none"></canvas>
<script src="index.js"></script></body></html>
```

- [ ] **Step 6: index.js 스켈레톤 작성 (fetch → 임시 렌더)**

```javascript
let ws = null;
const contexts = new Set();

// 덱이 이 함수를 호출한다 (Elgato SDK 진입점)
function connectElgatoStreamDeckSocket(port, uuid, registerEvent, info) {
  ws = new WebSocket("ws://127.0.0.1:" + port);
  ws.onopen = () => ws.send(JSON.stringify({ uuid, event: registerEvent }));
  ws.onmessage = (e) => {
    const d = JSON.parse(e.data);
    if (d.event === "willAppear") { contexts.add(d.context); renderAll(); }
    else if (d.event === "willDisappear") { contexts.delete(d.context); }
  };
}

function setImage(context, dataURL) {
  ws && ws.send(JSON.stringify({ event: "setImage", context, payload: { target: 0, image: dataURL } }));
}

async function fetchUsage() {
  const res = await fetch("./data/usage.json?ts=" + Date.now());  // R1 검증 지점
  return await res.json();
}

// Task 3에서 진짜 게이지로 교체. 지금은 rem_7d 숫자만 그려 fetch+setImage 증명.
function renderTemp(u) {
  const cv = document.getElementById("c"), ctx = cv.getContext("2d");
  ctx.fillStyle = "#0D1117"; ctx.fillRect(0, 0, 144, 144);
  ctx.fillStyle = "#3FB950"; ctx.font = "bold 48px sans-serif";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText((u && u.rem_7d != null ? u.rem_7d : "--") + "%", 72, 72);
  return cv.toDataURL("image/png");
}

async function renderAll() {
  let u = null;
  try { u = await fetchUsage(); console.log("[CU] fetch ok", u); }
  catch (err) { console.log("[CU] fetch FAILED", String(err)); }  // R1 실패 시 여기 로그
  const img = renderTemp(u);
  contexts.forEach((c) => setImage(c, img));
}
```

- [ ] **Step 7: 멱등 설치 스크립트 작성** — `install.sh`

```bash
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
```

- [ ] **Step 8: 설치 + 실물 검증 (R1 게이트)**

Run: `cd ~/streamdock-claude-usage && python3 scaffold_assets.py && bash install.sh`
그다음 MONSTAR DECK 앱에서 액션 목록의 **"Claude Usage"** 를 키 하나에 드래그.
Expected(성공): 버튼에 `76%`(초록) 표시. → **R1 통과: 로컬 fetch 사용 확정, Task 4 파일 방식 진행.**
Expected(실패): 버튼이 `--%` 표시 + 덱 개발자 콘솔에 `[CU] fetch FAILED`. → **R1 실패: Appendix B(localhost 브리지)로 전환** 후 Task 4를 브리지 방식으로 대체.

> 콘솔 확인: MONSTAR DECK이 CEF 원격 디버깅을 노출하면 `http://localhost:<port>`에서, 아니면 `~/Library/Application Support/HotSpot/StreamDock/logs/` 로그로 `[CU]` 라인 확인.

- [ ] **Step 9: 커밋**

```bash
cd ~/streamdock-claude-usage
git add plugin scaffold_assets.py install.sh
git commit -m "feat: 플러그인 스켈레톤 + SDK 루프 + R1 로컬 fetch 검증"
```

---

### Task 2: 순수 렌더 헬퍼 (TDD, node --test)

캔버스에 의존하지 않는 순수 함수만 먼저 test-drive. 브라우저/노드 양쪽에서 로드되게 UMD 패턴.

**Files:**
- Create: `plugin/com.taehyeong.streamdock.claudeusage.sdPlugin/plugin/helpers.js`
- Test: `tests/helpers.test.js`

**Interfaces:**
- Produces: `CU.ringColor(rem)->hex`, `CU.isStaleData(data, nowMs, maxAgeSec=90)->bool`. 브라우저에선 전역 `CU`, 노드에선 `module.exports`. (남은% = 100−pct 및 reset 문자열 변환은 Python 라이터가 전담 — Task 4. 플러그인은 이미 변환된 값을 신뢰만 함.)

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/helpers.test.js`

```javascript
const test = require('node:test');
const assert = require('node:assert');
const CU = require('../plugin/com.taehyeong.streamdock.claudeusage.sdPlugin/plugin/helpers.js');

test('ringColor thresholds', () => {
  assert.equal(CU.ringColor(51), '#3FB950'); // >50 초록
  assert.equal(CU.ringColor(50), '#D29922'); // 경계=주황
  assert.equal(CU.ringColor(20), '#D29922'); // >=20 주황
  assert.equal(CU.ringColor(19), '#F85149'); // <20 빨강
});

test('isStaleData: flag OR file age', () => {
  const now = 1_000_000_000_000;
  assert.equal(CU.isStaleData({ stale: true, ts: now / 1000 }, now), true);
  assert.equal(CU.isStaleData({ stale: false, ts: now / 1000 }, now), false);
  assert.equal(CU.isStaleData({ stale: false, ts: now / 1000 - 100 }, now), true); // 100s>90s
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd ~/streamdock-claude-usage && node --test tests/helpers.test.js`
Expected: FAIL — `Cannot find module '.../helpers.js'`.

- [ ] **Step 3: helpers.js 구현**

```javascript
(function (root) {
  function ringColor(rem) {
    if (rem > 50) return '#3FB950';
    if (rem >= 20) return '#D29922';
    return '#F85149';
  }
  function isStaleData(data, nowMs, maxAgeSec) {
    if (!data) return true;
    if (data.stale === true) return true;
    const age = maxAgeSec === undefined ? 90 : maxAgeSec;
    if (!data.ts) return false;
    return (nowMs / 1000 - data.ts) > age;
  }
  const api = { ringColor, isStaleData };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.CU = api;
})(typeof self !== 'undefined' ? self : this);
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd ~/streamdock-claude-usage && node --test tests/helpers.test.js`
Expected: PASS — 2 tests, 0 fail.

- [ ] **Step 5: 커밋**

```bash
git add plugin/com.taehyeong.streamdock.claudeusage.sdPlugin/plugin/helpers.js tests/helpers.test.js
git commit -m "feat: 순수 렌더 헬퍼 + node --test"
```

---

### Task 3: 게이지 렌더 + 30초 타이머 (실물 검증)

헬퍼를 써서 진짜 게이지(주간 링 + 5h 구석 + stale)를 그리고, Web Worker 타이머로 30초마다 갱신.

**Files:**
- Create: `plugin/com.taehyeong.streamdock.claudeusage.sdPlugin/plugin/timer.worker.js`
- Modify: `plugin/com.taehyeong.streamdock.claudeusage.sdPlugin/plugin/index.html` (helpers.js 로드 추가)
- Modify: `plugin/com.taehyeong.streamdock.claudeusage.sdPlugin/plugin/index.js` (renderTemp → drawGauge, 타이머)

**Interfaces:**
- Consumes: `CU.*` (Task 2), `data/usage.json` (Task 1).
- Produces: `drawGauge(ctx, u, nowMs)` — 144×144 캔버스에 완성 게이지.

- [ ] **Step 1: Web Worker 타이머 작성** — `timer.worker.js`

```javascript
// time/interval.js 패턴: 메인스레드 타이머 지연 회피
let id = null;
self.onmessage = ({ data }) => {
  if (data.event === 'start') {
    if (id) return;
    id = setInterval(() => self.postMessage({ event: 'tick' }), data.delay);
  } else if (data.event === 'stop') {
    clearInterval(id); id = null;
  }
};
```

- [ ] **Step 2: index.html에 helpers.js 로드 추가**

```html
<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body><canvas id="c" width="144" height="144" style="display:none"></canvas>
<script src="helpers.js"></script>
<script src="index.js"></script></body></html>
```

- [ ] **Step 3: index.js에 drawGauge 추가 + renderTemp 대체**

```javascript
// index.js — renderTemp 함수를 아래 drawGauge로 교체하고 renderAll에서 호출
function drawGauge(ctx, u, nowMs) {
  const W = 144, cx = 72, cy = 78, r = 46;
  ctx.clearRect(0, 0, W, W);
  ctx.fillStyle = "#0D1117"; ctx.fillRect(0, 0, W, W);

  const avail = u && u.available !== false;
  const rem7 = u ? u.rem_7d : null;
  const rem5 = u ? u.rem_5h : null;
  const stale = CU.isStaleData(u, nowMs);

  // 주간 링 (트랙)
  ctx.lineWidth = 12; ctx.lineCap = "round";
  ctx.strokeStyle = "#21262D";
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();

  // 주간 링 (채움) — 12시 시작 시계방향
  if (avail && rem7 != null) {
    const start = -Math.PI / 2;
    const end = start + (Math.PI * 2) * (rem7 / 100);
    ctx.strokeStyle = CU.ringColor(rem7);
    if (stale) ctx.globalAlpha = 0.35;
    ctx.beginPath(); ctx.arc(cx, cy, r, start, end); ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // 중앙 주간 %
  ctx.fillStyle = stale ? "#6E7681" : "#E6EDF3";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.font = "bold 34px sans-serif";
  ctx.fillText(avail && rem7 != null ? rem7 + "%" : "—", cx, cy - 2);
  ctx.font = "11px sans-serif"; ctx.fillStyle = "#8B949E";
  ctx.fillText("주간남음", cx, cy + 22);

  // 상단 구석 5h
  ctx.font = "bold 15px sans-serif"; ctx.textAlign = "left"; ctx.textBaseline = "top";
  ctx.fillStyle = avail && rem5 != null ? "#58A6FF" : "#6E7681";
  ctx.fillText("5h " + (avail && rem5 != null ? rem5 + "%" : "—"), 8, 8);

  // stale 점
  if (stale) { ctx.fillStyle = "#D29922"; ctx.beginPath(); ctx.arc(134, 12, 5, 0, Math.PI * 2); ctx.fill(); }

  return ctx.canvas.toDataURL("image/png");
}

async function renderAll() {
  let u = null;
  try { u = await fetchUsage(); } catch (err) { console.log("[CU] fetch FAILED", String(err)); }
  const ctx = document.getElementById("c").getContext("2d");
  const img = drawGauge(ctx, u, Date.now());
  contexts.forEach((c) => setImage(c, img));
}

// 타이머 기동 (connectElgatoStreamDeckSocket 하단 또는 첫 willAppear에서 1회)
const worker = new Worker("timer.worker.js");
worker.onmessage = () => renderAll();
worker.postMessage({ event: "start", delay: 30000 });
```

- [ ] **Step 4: 재설치 후 실물 검증 — 정상**

Run: `cd ~/streamdock-claude-usage && bash install.sh`
액션을 키에 배치.
Expected: 버튼에 **주간 76% 초록 링 + 중앙 `76%` + 상단 `5h 95%`(파랑) + 하단 `주간남음`**.

- [ ] **Step 5: 실물 검증 — stale/저잔량**

Run:
```bash
F="$HOME/Library/Application Support/HotSpot/StreamDock/plugins/com.taehyeong.streamdock.claudeusage.sdPlugin/plugin/data/usage.json"
echo '{"rem_5h":15,"rem_7d":12,"reset_5h":"07/16 00:00","reset_7d":"07/20 19:00","stale":true,"available":true,"ts":0}' > "$F"
```
30초 대기(또는 키 재배치).
Expected: 링이 **빨강 + 흐릿(alpha 0.35) + 우상단 주황 점**, 중앙 `12%` 회색. → placeholder 원복: `git checkout -- .../data/usage.json` 후 재설치.

- [ ] **Step 6: 커밋**

```bash
git add plugin/com.taehyeong.streamdock.claudeusage.sdPlugin
git commit -m "feat: 게이지 렌더(주간 링+5h+stale) + 30초 Web Worker 타이머"
```

---

### Task 4: Python 라이터 (TDD, pytest)

`token_status_data.js` → `usage.json` 변환을 순수 함수로 test-drive하고, CLI로 원자적 write.

**Files:**
- Create: `writer/usage_payload.py`
- Create: `writer/write_usage.py`
- Test: `tests/test_usage_payload.py`

**Interfaces:**
- Produces: `build_payload(claude: dict, now_ts: int) -> dict` (스키마 `{rem_5h,rem_7d,reset_5h,reset_7d,stale,available,ts}`), `write_usage(src_js: str, dest_json: str, now_ts: int) -> dict`.

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/test_usage_payload.py`

```python
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'writer'))
from usage_payload import build_payload

CLAUDE = {"available": True, "pct_5h": 5, "pct_7d": 24,
          "reset_5h": "07/16 00:00 KST", "reset_7d": "07/20 19:00 KST",
          "pct_source": "cache", "pct_stale_min": 14}

def test_rem_is_100_minus_pct():
    p = build_payload(CLAUDE, 1752620472)
    assert p["rem_5h"] == 95 and p["rem_7d"] == 76

def test_reset_trimmed():
    p = build_payload(CLAUDE, 0)
    assert p["reset_5h"] == "07/16 00:00" and p["reset_7d"] == "07/20 19:00"

def test_stale_false_below_threshold():
    assert build_payload(CLAUDE, 0)["stale"] is False  # stale_min 14 < 15

def test_stale_true_at_threshold():
    c = dict(CLAUDE, pct_stale_min=15)
    assert build_payload(c, 0)["stale"] is True

def test_stale_false_when_not_cache():
    c = dict(CLAUDE, pct_source="live", pct_stale_min=99)
    assert build_payload(c, 0)["stale"] is False

def test_clamp_and_none():
    c = dict(CLAUDE, pct_5h=130, pct_7d=None)
    p = build_payload(c, 0)
    assert p["rem_5h"] == 0 and p["rem_7d"] is None

def test_available_and_ts_passthrough():
    p = build_payload(dict(CLAUDE, available=False), 42)
    assert p["available"] is False and p["ts"] == 42
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd ~/streamdock-claude-usage && python3 -m pytest tests/test_usage_payload.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'usage_payload'`.

- [ ] **Step 3: build_payload 구현** — `writer/usage_payload.py`

```python
"""token_status_data.js의 claude dict → 덱 플러그인 usage.json 페이로드 (순수 함수)."""

def _rem(p):
    try:
        return max(0, min(100, round(100 - float(p))))
    except (TypeError, ValueError):
        return None

def _trim_reset(s):
    if not s:
        return ""
    return str(s).replace(" KST", "").strip()

def build_payload(claude, now_ts):
    return {
        "rem_5h": _rem(claude.get("pct_5h")),
        "rem_7d": _rem(claude.get("pct_7d")),
        "reset_5h": _trim_reset(claude.get("reset_5h")),
        "reset_7d": _trim_reset(claude.get("reset_7d")),
        "stale": bool(claude.get("pct_source") == "cache"
                      and (claude.get("pct_stale_min") or 0) >= 15),
        "available": bool(claude.get("available", False)),
        "ts": int(now_ts),
    }
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd ~/streamdock-claude-usage && python3 -m pytest tests/test_usage_payload.py -q`
Expected: PASS — 7 passed.

- [ ] **Step 5: CLI 라이터 구현** — `writer/write_usage.py`

```python
#!/usr/bin/env python3
"""token_status_data.js를 읽어 usage.json을 원자적으로 쓴다. 독립 실행/테스트용."""
import json, os, sys, time, tempfile
sys.path.insert(0, os.path.dirname(__file__))
from usage_payload import build_payload

def _load_claude(src_js):
    with open(src_js, "r", encoding="utf-8") as f:
        raw = f.read().strip()
    if raw.startswith("window.__tokenData ="):
        raw = raw[len("window.__tokenData ="):].strip()
    if raw.endswith(";"):
        raw = raw[:-1]
    return json.loads(raw).get("claude", {})

def write_usage(src_js, dest_json, now_ts=None):
    now_ts = int(now_ts if now_ts is not None else time.time())
    payload = build_payload(_load_claude(src_js), now_ts)
    os.makedirs(os.path.dirname(dest_json), exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(dest_json), suffix=".tmp")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False)
    os.replace(tmp, dest_json)
    return payload

if __name__ == "__main__":
    src = os.environ.get("TOKEN_STATUS_JS",
        os.path.expanduser("~/NERV/Agents/Lab Director/agent-monitor/output/token_status_data.js"))
    dest = os.environ["STREAMDOCK_USAGE_JSON"]
    print(write_usage(src, dest))
```

- [ ] **Step 6: 실데이터로 스모크 테스트**

Run:
```bash
cd ~/streamdock-claude-usage
STREAMDOCK_USAGE_JSON="/tmp/cu_smoke.json" python3 writer/write_usage.py && cat /tmp/cu_smoke.json
```
Expected: `{"rem_5h": 95, "rem_7d": 76, ...}` 형태 — 실제 남은% 반영, 유효 JSON.

- [ ] **Step 7: 커밋**

```bash
git add writer tests/test_usage_payload.py
git commit -m "feat: usage.json 라이터(build_payload + 원자적 write) + pytest"
```

---

### Task 5: agent-monitor 폴딩 (NERV worktree)

라이브 데이터가 플러그인 폴더로 흐르게 NERV `token_status_writer.py`에 env-gated write를 얹는다. **NERV 불변식 준수: worktree에서만.**

**Files:**
- Modify: `~/NERV/Agents/Lab Director/project-dashboard/token_status_writer.py` (token_status_data.js write 직후)

**Interfaces:**
- Consumes: `build_payload` 로직(Task 4와 동일 규칙 — 인라인 복제, tests/test_usage_payload.py가 행위 계약).

- [ ] **Step 1: NERV worktree 생성**

Run:
```bash
cd ~/NERV && git worktree add ~/NERV-wt/streamdock-usage -b streamdock-usage
```
Expected: worktree 생성, 브랜치 `streamdock-usage`.

- [ ] **Step 2: write 지점 확인**

Run: `grep -n "token_status_data.js\|def \|\.write(\|json.dump" "~/NERV-wt/streamdock-usage/Agents/Lab Director/project-dashboard/token_status_writer.py" | head -30`
Expected: `token_status_data.js`를 쓰는 함수/라인 식별 (claude dict가 in-scope인 지점).

- [ ] **Step 3: env-gated 인라인 write 추가**

token_status_data.js를 쓰는 코드 **직후**, claude dict가 접근 가능한 스코프에 삽입 (변수명은 Step 2 실측에 맞춤):

```python
# --- StreamDock 덱 게이지 연동 (env 설정 시에만, 실패해도 본 기능 무영향) ---
_sd_dest = os.environ.get("STREAMDOCK_USAGE_JSON")
if _sd_dest:
    try:
        import tempfile as _tf
        def _sd_rem(p):
            try: return max(0, min(100, round(100 - float(p))))
            except (TypeError, ValueError): return None
        _c = claude_data  # ← Step 2에서 확인한 실제 claude dict 변수명으로 교체
        _sd_payload = {
            "rem_5h": _sd_rem(_c.get("pct_5h")), "rem_7d": _sd_rem(_c.get("pct_7d")),
            "reset_5h": (_c.get("reset_5h") or "").replace(" KST", "").strip(),
            "reset_7d": (_c.get("reset_7d") or "").replace(" KST", "").strip(),
            "stale": bool(_c.get("pct_source") == "cache" and (_c.get("pct_stale_min") or 0) >= 15),
            "available": bool(_c.get("available", False)), "ts": int(time.time()),
        }
        os.makedirs(os.path.dirname(_sd_dest), exist_ok=True)
        _fd, _tmp = _tf.mkstemp(dir=os.path.dirname(_sd_dest), suffix=".tmp")
        with os.fdopen(_fd, "w", encoding="utf-8") as _f:
            json.dump(_sd_payload, _f, ensure_ascii=False)
        os.replace(_tmp, _sd_dest)
    except Exception as _e:
        print(f"[streamdock] usage.json write skipped: {_e}")
```

> `os`, `json`, `time` import가 파일 상단에 없으면 추가.

- [ ] **Step 4: launchd에 env 주입**

`~/NERV/Agents/Lab Director/agent-monitor`의 launchd plist(`com.nerv.agent-monitor`)에 `EnvironmentVariables.STREAMDOCK_USAGE_JSON` = 플러그인 data 경로 추가:
```
$HOME/Library/Application Support/HotSpot/StreamDock/plugins/com.taehyeong.streamdock.claudeusage.sdPlugin/plugin/data/usage.json
```
plist 편집 → `launchctl unload && load` → `plutil -lint` 통과 확인.

- [ ] **Step 5: 라이브 검증**

데몬 1주기(≤30초) 대기 후:
Run: `cat "$HOME/Library/Application Support/HotSpot/StreamDock/plugins/com.taehyeong.streamdock.claudeusage.sdPlugin/plugin/data/usage.json"`
Expected: 실제 남은% 반영 + `ts`가 현재시각. 이후 30초마다 `ts` 갱신.
그리고 덱 버튼이 30초 내 실제 사용량으로 자동 갱신되는지 **실물 관찰**.

- [ ] **Step 6: NERV 커밋 (worktree)**

```bash
cd ~/NERV-wt/streamdock-usage
git add "Agents/Lab Director/project-dashboard/token_status_writer.py" ~/Library/LaunchAgents/com.nerv.agent-monitor.plist 2>/dev/null || \
  git add "Agents/Lab Director/project-dashboard/token_status_writer.py"
git commit -m "feat(agent-monitor): StreamDock 덱 게이지용 usage.json env-gated write"
```
> plist가 repo 밖이면 별도 관리. NERV pre-commit 훅(Stage 0 worktree 가드) 통과 확인.

---

### Task 6: 마무리 — README + persistence + .gitignore

**Files:**
- Create: `README.md`, `.gitignore`
- Create: `propertyInspector/index.html` (최소)
- Create: `{en,ko}.json` (액션 라벨 현지화)

- [ ] **Step 1: 최소 Property Inspector** — `plugin/.../propertyInspector/index.html`

```html
<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="font:12px sans-serif;color:#8B949E;padding:12px">
Claude Code 남은 사용량 게이지. 데이터는 agent-monitor의 usage.json에서 자동 갱신됩니다. 설정 없음.
</body></html>
```
그리고 manifest 액션에 `"PropertyInspectorPath": "propertyInspector/index.html"` 추가.

- [ ] **Step 2: 현지화 파일** — `plugin/.../en.json`, `ko.json`

```json
{ "Name": "Claude Usage", "com.taehyeong.streamdock.claudeusage.gauge": "Claude Usage" }
```
(ko.json도 동일 구조, `"Name": "클로드 사용량"`)

- [ ] **Step 3: .gitignore**

```
__pycache__/
*.pyc
.pytest_cache/
node_modules/
```

- [ ] **Step 4: README 작성** — 설치/재설치/persistence/폴백(Appendix B) 요약

```markdown
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
```

- [ ] **Step 5: 전체 테스트 재확인 + 최종 설치 검증**

Run: `cd ~/streamdock-claude-usage && node --test tests/helpers.test.js && python3 -m pytest tests/ -q && bash install.sh`
Expected: JS/PY 테스트 all pass, 설치 성공, 덱 버튼 정상 렌더.

- [ ] **Step 6: 커밋**

```bash
git add -A
git commit -m "docs: README + PI + 현지화 + .gitignore"
```

---

## Appendix A — SDK 메시지 레퍼런스 (weather 플러그인 실측)

- 연결: 덱이 `connectElgatoStreamDeckSocket(port, uuid, registerEvent, info)` 호출 → `new WebSocket("ws://127.0.0.1:"+port)` → onopen `send({uuid, event: registerEvent})`.
- 수신: `{event, context, action, payload}`. 관심 이벤트: `willAppear`(context 등장), `willDisappear`(사라짐), `keyDown`(이번 범위 미사용).
- `setImage`: `{event:"setImage", context, payload:{target:0, image:<dataURL 또는 url>}}`.
- `setTitle`: `{event:"setTitle", context, payload:{target:0, title}}`.

## Appendix B — R1 실패 시 폴백 (localhost 브리지)

Task 1 Step 8에서 로컬 fetch가 막히면:
1. Task 4의 `write_usage.py` 대신, agent-monitor 프로세스 내에서 `http.server`로 `127.0.0.1:<port>/claude-usage`에 payload를 JSON 서빙 (단일 클라이언트, keep-alive 없음). weather가 이미 원격 fetch로 검증한 경로.
2. 플러그인 `fetchUsage()`를 `fetch("http://127.0.0.1:<port>/claude-usage")`로 변경.
3. 나머지(렌더/타이머/헬퍼)는 무변경. Task 2·3의 테스트/렌더 로직 그대로 재사용.
4. 포트 상수는 플러그인·서버 양쪽 합의값 하나. NERV의 프로세스 증식/TIME_WAIT 이력 감안 — 단일 상시 포트 1개로 제한, 요청당 연결 즉시 종료.
