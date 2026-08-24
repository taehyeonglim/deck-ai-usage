# Gemini 5h/주간 창 분리 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 덱의 Gemini 게이지를 Claude/Codex와 동일하게 5h·주간 2축으로 분리하고, 두 축 모두에 리셋-경과 보정을 적용한다.

**Architecture:** 수집기(NERV `token_collector.py`)는 이미 `pct_5h`/`pct_weekly`를 분리해 싣고 있다. 변환 계층(페이로드 빌더 2곳)에 `gemini_5h`/`gemini_7d` 키를 추가하고, Codex 전용이던 리셋-경과 보정 헬퍼를 "스냅샷형 프로바이더" 공통 규율로 일반화해 재사용한다. 플러그인은 액션 2개를 신설하고 기존 Gemini 액션의 UUID는 유지한 채 표시명과 조회 키만 바꾼다.

**Tech Stack:** Python 3 (pytest), Vanilla JS (node --test), Elgato Stream Deck SDK v1 manifest

## Global Constraints

- 스펙: `docs/superpowers/specs/2026-08-24-gemini-5h-weekly-split-design.md`
- 기존 UUID `com.taehyeong.streamdock.claudeusage.gemini` / `.geminiReset`는 **절대 변경/삭제 금지** — 덱에 배치된 물리 버튼이 깨진다. 표시명과 조회 키만 바꾼다.
- legacy 페이로드 키 `gemini`(= 5h)는 **존치** — writer와 플러그인의 배포 시점이 달라 버전 스큐가 실재한다.
- 페이로드 주간 키 이름은 `gemini_7d` (형제 `claude_7d`/`codex_7d`와 일치. 수집기 쪽 원본 이름은 `weekly`).
- Gemini accent 색: `#4285F4`
- `token_collector.py`는 **변경하지 않는다.** 이 파일을 편집하고 있다면 스코프를 벗어난 것이다.
- age 기반 stale 표시는 **비목표** — 구현하지 않는다.
- 테스트 러너: `node --test tests/helpers.test.js` · `python3 -m pytest tests/ -q`
- 작업 브랜치: `gemini-5h-weekly-split` (repo `~/streamdock-claude-usage`)

---

### Task 1: 페이로드 빌더에 Gemini 2축 추가 (repo)

**Files:**
- Modify: `writer/usage_payload.py:1-5` (docstring), `:33-40` (`_codex_metric`), `:49-56` (`build_payload` 반환)
- Test: `tests/test_usage_payload.py`

**Interfaces:**
- Consumes: 없음 (첫 태스크)
- Produces: `build_payload(token_data, now_ts)` 반환 dict에 키 `gemini_5h`, `gemini_7d` 추가. 각각 `{"rem": int|None, "reset": str, "stale": bool, "available": bool}`. 기존 키 `gemini`는 그대로 유지. 내부 헬퍼 `_codex_metric` → `_snapshot_metric(prov, pct_key, reset_key, reset_at_key, now_ts)`로 개명(시그니처 동일).

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/test_usage_payload.py` 파일 끝에 추가

```python
# agy statusline tee 경로의 실제 페이로드 형태 (2026-08-24 실측)
GEM = {"gemini": {"available": True,
                  "pct_used": 20, "reset": "08/24 14:51 KST",
                  "pct_5h": 20, "reset_5h": "08/24 14:51 KST",
                  "reset_5h_at": 1787550681,
                  "pct_weekly": 12, "reset_weekly": "08/26 23:00 KST",
                  "reset_weekly_at": 1787752820}}


def test_gemini_two_windows():
    p = build_payload(GEM, 1787540000)  # 두 리셋 모두 미래
    assert p["gemini_5h"]["rem"] == 80 and p["gemini_5h"]["reset"] == "08/24 14:51"
    assert p["gemini_7d"]["rem"] == 88 and p["gemini_7d"]["reset"] == "08/26 23:00"


def test_gemini_5h_expired_corrects_to_100():
    # agy 원장은 agy가 돌 때만 갱신 → 리셋 지났으면 새 창(사용 0)
    p = build_payload(GEM, 1787571768)  # 5h 지남, 주간은 미래
    assert p["gemini_5h"]["rem"] == 100 and p["gemini_5h"]["reset"] == ""
    assert p["gemini_7d"]["rem"] == 88  # 주간은 무보정


def test_gemini_legacy_key_stays_5h():
    # 구 플러그인 + 신 writer 스큐 방어
    p = build_payload(GEM, 1787540000)
    assert p["gemini"]["rem"] == 80 and p["gemini"]["reset"] == "08/24 14:51"


def test_gemini_weekly_null_pct():
    t = {"gemini": dict(GEM["gemini"], pct_weekly=None, reset_weekly_at=None)}
    p = build_payload(t, 1787540000)
    assert p["gemini_7d"]["rem"] is None
    assert p["gemini_7d"]["available"] is True  # 플러그인이 "—" 렌더


def test_gemini_legacy_only_source_has_no_axes():
    # agy 폴백(gemini-cli quota API)엔 pct_5h/pct_weekly가 없다
    p = build_payload(TOKEN, 0)
    assert p["gemini_5h"]["rem"] is None and p["gemini_7d"]["rem"] is None
    assert p["gemini"]["rem"] == 100  # legacy 경로는 그대로 산다
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `cd ~/streamdock-claude-usage && python3 -m pytest tests/test_usage_payload.py -q`
Expected: 새 테스트 5개가 `KeyError: 'gemini_5h'`로 FAIL. 기존 11개는 PASS.

- [ ] **Step 3: 헬퍼 일반화 + 2축 추가** — `writer/usage_payload.py`

`_codex_metric`을 아래로 교체 (이름과 주석만 바뀌고 본문 로직은 동일):

```python
def _snapshot_metric(prov, pct_key, reset_key, reset_at_key, now_ts):
    # 스냅샷형 프로바이더(Codex CLI·Gemini agy 원장)는 도구가 돌 때만 갱신된다.
    # 예정된 리셋 시각이 지났다면 새 창이 열렸고 그 후 사용도 0이므로
    # (사용했다면 새 스냅샷이 생긴다) 남은 100%로 보정한다.
    # 다음 리셋 시각은 미상이라 비운다.
    m = _metric(prov, pct_key, reset_key, False)
    if m["available"] and _window_expired(prov, reset_at_key, now_ts):
        m["rem"], m["reset"] = 100, ""
    return m
```

`build_payload`의 반환 dict를 아래로 교체:

```python
    return {
        "claude_5h": _metric(claude, "pct_5h", "reset_5h", claude_stale),
        "claude_7d": _metric(claude, "pct_7d", "reset_7d", claude_stale),
        "codex_5h": _snapshot_metric(codex, "pct_5h", "reset_5h", "reset_5h_at", now_ts),
        "codex_7d": _snapshot_metric(codex, "pct_7d", "reset_7d", "reset_7d_at", now_ts),
        "gemini_5h": _snapshot_metric(gemini, "pct_5h", "reset_5h", "reset_5h_at", now_ts),
        "gemini_7d": _snapshot_metric(gemini, "pct_weekly", "reset_weekly",
                                      "reset_weekly_at", now_ts),
        # legacy(= 5h). 구 플러그인 + 신 writer 스큐 방어용으로 존치.
        "gemini": _metric(gemini, "pct_used", "reset", False),
        "ts": int(now_ts),
    }
```

모듈 docstring(1-5행)의 `5지표 중첩 스키마: claude_5h, claude_7d, codex_5h, codex_7d, gemini` 줄을 아래로 교체:

```
7지표 중첩 스키마: claude_5h, claude_7d, codex_5h, codex_7d, gemini_5h, gemini_7d,
gemini(legacy = 5h) — 각 {rem,reset,stale,available} + 최상위 ts.
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd ~/streamdock-claude-usage && python3 -m pytest tests/test_usage_payload.py -q`
Expected: 16 passed. 기존 `test_gemini_single_metric`·`test_codex_gemini_never_stale_flag`도 legacy 키 존치 덕에 그대로 PASS해야 한다 — 실패하면 legacy 키를 건드린 것이므로 되돌린다.

- [ ] **Step 5: 커밋**

```bash
cd ~/streamdock-claude-usage
git add writer/usage_payload.py tests/test_usage_payload.py
git commit -m "feat(writer): Gemini 5h/주간 2축 페이로드 키 추가

수집기가 이미 싣고 있던 pct_5h/pct_weekly를 gemini_5h/gemini_7d로 노출.
Codex 전용이던 리셋-경과 보정을 _snapshot_metric으로 일반화해 재사용한다
(agy 원장도 agy가 돌 때만 갱신되는 같은 부류). legacy gemini 키는 존치."
```

---

### Task 2: NERV writer 동기 패치 + 라이브 반영

**Files:**
- Modify: `/Users/taehyeong/NERV/Agents/Lab Director/project-dashboard/token_status_writer.py` (`_write_streamdock_usage` 내부 `_codex_metric` 정의부와 `payload` dict)

**Interfaces:**
- Consumes: Task 1이 정한 키 이름 `gemini_5h`, `gemini_7d`와 legacy `gemini` 존치 규칙
- Produces: 라이브 `~/Library/Application Support/HotSpot/StreamDock/plugins/com.taehyeong.streamdock.claudeusage.sdPlugin/plugin/data/usage.json`에 `gemini_5h`/`gemini_7d` 키가 실제로 기록됨

> 이 파일은 `writer/usage_payload.py`를 import하지 않고 **로직을 각자 들고 있는 vendored 사본**이다. Task 1과 반드시 동일하게 맞춘다. 이쪽이 라이브 파일을 실제로 쓰는 쪽이다.

- [ ] **Step 1: 헬퍼를 prov 인자로 일반화**

`token_status_writer.py`의 `_codex_metric` 정의(`codex`를 클로저로 잡고 있는 중첩 함수)를 아래로 교체:

```python
        def _snapshot_metric(prov, pk, rk, rak):
            # 스냅샷형 프로바이더(Codex CLI·Gemini agy 원장)는 도구가 돌 때만
            # 갱신됨. 예정된 리셋 시각이 지났다면 새 창이 열렸고 그 후 사용도
            # 0이므로 남은 100%로 보정. 다음 리셋 시각은 미상이라 비운다.
            m = _metric(prov, pk, rk, False)
            try:
                expired = float((prov or {}).get(rak)) <= now_ts
            except (TypeError, ValueError):
                expired = False
            if m['available'] and expired:
                m['rem'], m['reset'] = 100, ''
            return m
```

- [ ] **Step 2: payload dict 교체**

```python
        payload = {
            'claude_5h': _metric(claude, 'pct_5h', 'reset_5h', cstale),
            'claude_7d': _metric(claude, 'pct_7d', 'reset_7d', cstale),
            'codex_5h': _snapshot_metric(codex, 'pct_5h', 'reset_5h', 'reset_5h_at'),
            'codex_7d': _snapshot_metric(codex, 'pct_7d', 'reset_7d', 'reset_7d_at'),
            'gemini_5h': _snapshot_metric(gemini, 'pct_5h', 'reset_5h', 'reset_5h_at'),
            'gemini_7d': _snapshot_metric(gemini, 'pct_weekly', 'reset_weekly',
                                          'reset_weekly_at'),
            # legacy(= 5h) — 구 플러그인 + 신 writer 스큐 방어용 존치
            'gemini': _metric(gemini, 'pct_used', 'reset', False),
            'ts': now_ts,
        }
```

- [ ] **Step 3: repo 사본과 동일한지 대조**

Run:
```bash
cd ~/streamdock-claude-usage && python3 - <<'PY'
import re
a = open('writer/usage_payload.py').read()
b = open('/Users/taehyeong/NERV/Agents/Lab Director/project-dashboard/token_status_writer.py').read()
keys = ['gemini_5h', 'gemini_7d', "'gemini'", '"gemini"', 'pct_weekly', 'reset_weekly_at']
for k in keys:
    print(f"{k:18} repo={k in a}  nerv={k in b}")
PY
```
Expected: `gemini_5h`/`gemini_7d`/`pct_weekly`/`reset_weekly_at` 모두 양쪽 True.

- [ ] **Step 4: 데몬 재시작 후 라이브 확인**

Run:
```bash
launchctl kickstart -k gui/501/com.nerv.agent-monitor
sleep 45
python3 -m json.tool ~/Library/Application\ Support/HotSpot/StreamDock/plugins/com.taehyeong.streamdock.claudeusage.sdPlugin/plugin/data/usage.json
```
Expected: `gemini_5h`와 `gemini_7d` 키가 존재. `gemini_7d.rem`은 88 근방(pct_weekly=12 기준), `gemini_5h`는 리셋 경과 상태면 `rem:100, reset:""`. `gemini` legacy 키도 그대로 존재.

> 데몬 재시작은 필수다 — 장기 실행 프로세스라 import된 옛 코드가 메모리에 남는다. 45초는 30초 수집 주기 + 여유.

- [ ] **Step 5: 커밋**

```bash
cd ~/NERV
git add "Agents/Lab Director/project-dashboard/token_status_writer.py"
git commit -m "feat(streamdock): Gemini 5h/주간 2축을 덱 usage.json에 노출

수집기가 agy tee 경로로 이미 싣던 pct_5h/pct_weekly를 gemini_5h/gemini_7d로
분리 기록. Codex 전용이던 리셋-경과 보정을 _snapshot_metric으로 일반화해
Gemini에도 적용 — agy 원장도 agy가 돌 때만 갱신되는 같은 스냅샷 부류라
창이 지나면 게이지가 얼어붙던 문제가 있었다. legacy gemini 키는 존치."
```

> `~/NERV`는 메인 클론이므로 **main 브랜치에만** 커밋한다. pre-commit HARD 게이트(브랜치 가드·nerv_lint·agent inventory)가 돌므로 실패 시 메시지를 그대로 보고하고 멈춘다.

---

### Task 3: 지표 조회 폴백 헬퍼 (TDD)

**Files:**
- Modify: `plugin/com.taehyeong.streamdock.claudeusage.sdPlugin/plugin/helpers.js:14` (api 객체)
- Test: `tests/helpers.test.js`

**Interfaces:**
- Consumes: Task 1의 키 이름
- Produces: `CU.pickMetric(usage, metric)` → `metric.key`로 조회하고 없으면 `metric.fallbackKey`로 폴백, 둘 다 없으면 `null`. Task 4가 `index.js`의 두 조회 지점에서 사용한다.

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/helpers.test.js` 파일 끝에 추가

```js
test('pickMetric: 신 키 우선, 없으면 구 키 폴백', () => {
  const u = { gemini_5h: { rem: 80 }, gemini: { rem: 42 } };
  assert.deepEqual(CU.pickMetric(u, { key: 'gemini_5h', fallbackKey: 'gemini' }), { rem: 80 });
});

test('pickMetric: 신 키 부재 시 구 키 (구 writer 스큐)', () => {
  const u = { gemini: { rem: 42 } };
  assert.deepEqual(CU.pickMetric(u, { key: 'gemini_5h', fallbackKey: 'gemini' }), { rem: 42 });
});

test('pickMetric: 둘 다 없으면 null', () => {
  assert.equal(CU.pickMetric({}, { key: 'gemini_5h', fallbackKey: 'gemini' }), null);
  assert.equal(CU.pickMetric(null, { key: 'gemini_5h' }), null);
  assert.equal(CU.pickMetric({ a: 1 }, null), null);
});

test('pickMetric: fallbackKey 없는 지표는 그대로', () => {
  assert.deepEqual(CU.pickMetric({ claude_5h: { rem: 5 } }, { key: 'claude_5h' }), { rem: 5 });
  assert.equal(CU.pickMetric({}, { key: 'claude_5h' }), null);
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `cd ~/streamdock-claude-usage && node --test tests/helpers.test.js`
Expected: 새 테스트 4개가 `CU.pickMetric is not a function`으로 FAIL. 기존 2개는 PASS.

- [ ] **Step 3: 헬퍼 구현** — `plugin/com.taehyeong.streamdock.claudeusage.sdPlugin/plugin/helpers.js`

`isStaleData` 함수 아래, `const api = ...` 위에 추가:

```js
  // 지표 조회 — 신 키가 없으면 구 키로 폴백.
  // writer(NERV)와 플러그인(StreamDock)은 배포 시점이 달라 스키마 스큐가 실재한다.
  function pickMetric(u, metric) {
    if (!u || !metric) return null;
    const d = u[metric.key];
    if (d != null) return d;
    if (!metric.fallbackKey) return null;
    return u[metric.fallbackKey] != null ? u[metric.fallbackKey] : null;
  }
```

14행의 api 객체를 교체:

```js
  const api = { ringColor, isStaleData, pickMetric };
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd ~/streamdock-claude-usage && node --test tests/helpers.test.js`
Expected: 6 pass, 0 fail.

- [ ] **Step 5: 커밋**

```bash
cd ~/streamdock-claude-usage
git add plugin/com.taehyeong.streamdock.claudeusage.sdPlugin/plugin/helpers.js tests/helpers.test.js
git commit -m "feat(plugin): 지표 조회 폴백 헬퍼 pickMetric 추가

writer와 플러그인의 배포 시점 차이로 usage.json 스키마 스큐가 생길 수 있다.
신 키(gemini_5h) 부재 시 구 키(gemini)로 떨어져 게이지가 죽지 않게 한다."
```

---

### Task 4: 액션 2종 신설 + Gemini 액션 재배선

**Files:**
- Modify: `plugin/com.taehyeong.streamdock.claudeusage.sdPlugin/manifest.json` (Actions 배열)
- Modify: `plugin/com.taehyeong.streamdock.claudeusage.sdPlugin/manifest.elgato.json` (Actions 배열 — 동일 내용)
- Modify: `plugin/com.taehyeong.streamdock.claudeusage.sdPlugin/ko.json`
- Modify: `plugin/com.taehyeong.streamdock.claudeusage.sdPlugin/en.json`
- Modify: `plugin/com.taehyeong.streamdock.claudeusage.sdPlugin/plugin/index.js:6-19` (METRICS), `:48`, `:93` (조회 지점)

**Interfaces:**
- Consumes: `CU.pickMetric(u, metric)` (Task 3), 페이로드 키 `gemini_5h`/`gemini_7d` (Task 1)
- Produces: 액션 UUID `com.taehyeong.streamdock.claudeusage.geminiWeekly`, `…geminiWeeklyReset`. 총 액션 14개.

- [ ] **Step 1: manifest.json에 액션 2개 추가**

`com.taehyeong.streamdock.claudeusage.gemini` 항목의 `"Name"`을 `"Gemini 5h"`, `"Tooltip"`을 `"Gemini 5h 남은 사용량"`으로 바꾼다. **UUID는 건드리지 않는다.**
`com.taehyeong.streamdock.claudeusage.geminiReset` 항목의 `"Name"`을 `"Gemini 5h 리셋"`, `"Tooltip"`을 `"Gemini 5h 리셋 시각"`으로 바꾼다. **UUID는 건드리지 않는다.**

`gemini` 항목 바로 뒤에 아래를 삽입:

```json
    {
      "UUID": "com.taehyeong.streamdock.claudeusage.geminiWeekly",
      "Icon": "images/icon",
      "Name": "Gemini 주간",
      "Tooltip": "Gemini 주간 남은 사용량",
      "States": [
        {
          "Image": "images/defaultImage",
          "TitleAlignment": "bottom"
        }
      ],
      "Controllers": [
        "Keypad"
      ],
      "UserTitleEnabled": false,
      "SupportedInMultiActions": false,
      "PropertyInspectorPath": "propertyInspector/index.html"
    },
```

`geminiReset` 항목 바로 뒤에 아래를 삽입:

```json
    {
      "UUID": "com.taehyeong.streamdock.claudeusage.geminiWeeklyReset",
      "Icon": "images/icon",
      "Name": "Gemini 주간 리셋",
      "Tooltip": "Gemini 주간 리셋 시각",
      "States": [
        {
          "Image": "images/defaultImage",
          "TitleAlignment": "bottom"
        }
      ],
      "Controllers": [
        "Keypad"
      ],
      "UserTitleEnabled": false,
      "SupportedInMultiActions": false,
      "PropertyInspectorPath": "propertyInspector/index.html"
    },
```

- [ ] **Step 2: manifest.elgato.json에 동일 변경 적용**

Step 1과 **완전히 같은** 4개 변경(Name/Tooltip 2건 수정 + 액션 2건 삽입)을 `manifest.elgato.json`에도 적용한다. 두 파일의 Actions 배열은 동일 내용이다.

- [ ] **Step 3: 로케일 갱신**

`ko.json`에서 `"…gemini": "Gemini"` → `"…gemini": "Gemini 5h"`, `"…geminiReset": "Gemini 리셋"` → `"…geminiReset": "Gemini 5h 리셋"`로 바꾸고 두 줄 추가:

```json
  "com.taehyeong.streamdock.claudeusage.geminiWeekly": "Gemini 주간",
  "com.taehyeong.streamdock.claudeusage.geminiWeeklyReset": "Gemini 주간 리셋",
```

`en.json`에서 `"…gemini": "Gemini"` → `"…gemini": "Gemini 5h"`, `"…geminiReset": "Gemini Reset"` → `"…geminiReset": "Gemini 5h Reset"`로 바꾸고 두 줄 추가:

```json
  "com.taehyeong.streamdock.claudeusage.geminiWeekly": "Gemini Weekly",
  "com.taehyeong.streamdock.claudeusage.geminiWeeklyReset": "Gemini Weekly Reset",
```

- [ ] **Step 4: manifest/로케일 정합 검증**

Run:
```bash
cd ~/streamdock-claude-usage/plugin/com.taehyeong.streamdock.claudeusage.sdPlugin && python3 - <<'PY'
import json
a = json.load(open('manifest.json'))['Actions']
b = json.load(open('manifest.elgato.json'))['Actions']
ko, en = json.load(open('ko.json')), json.load(open('en.json'))
ua = [x['UUID'] for x in a]
assert len(ua) == 14, f"manifest.json actions={len(ua)}"
assert ua == [x['UUID'] for x in b], "두 manifest의 UUID 목록 불일치"
assert len(set(ua)) == 14, "UUID 중복"
for u in ua:
    assert u in ko, f"ko.json 누락: {u}"
    assert u in en, f"en.json 누락: {u}"
for u in ('com.taehyeong.streamdock.claudeusage.gemini',
          'com.taehyeong.streamdock.claudeusage.geminiReset'):
    assert u in ua, f"기존 UUID 사라짐: {u}"
print("OK — actions 14, UUID 정합, 로케일 완비, 기존 UUID 보존")
PY
```
Expected: `OK — actions 14, UUID 정합, 로케일 완비, 기존 UUID 보존`

- [ ] **Step 5: index.js METRICS 재배선**

`plugin/index.js`의 gemini 게이지 행(11행)을 아래 2줄로 교체:

```js
  "com.taehyeong.streamdock.claudeusage.gemini":        { key: "gemini_5h", fallbackKey: "gemini", label: "Gemini 5h", accent: "#4285F4", mode: "gauge" },
  "com.taehyeong.streamdock.claudeusage.geminiWeekly":  { key: "gemini_7d", label: "Gemini 주간", accent: "#4285F4", mode: "gauge" },
```

gemini 리셋 행(16행)을 아래 2줄로 교체:

```js
  "com.taehyeong.streamdock.claudeusage.geminiReset":       { key: "gemini_5h", fallbackKey: "gemini", label: "Gemini 5h", accent: "#4285F4", mode: "reset" },
  "com.taehyeong.streamdock.claudeusage.geminiWeeklyReset": { key: "gemini_7d", label: "Gemini 주간", accent: "#4285F4", mode: "reset" },
```

- [ ] **Step 6: 조회 지점 2곳을 pickMetric으로 교체**

`plugin/index.js` 48행과 93행의

```js
  const data = u ? u[metric.key] : null;
```

을 각각 아래로 교체:

```js
  const data = CU.pickMetric(u, metric);
```

- [ ] **Step 7: 문법 확인 + 전체 테스트**

Run:
```bash
cd ~/streamdock-claude-usage
node --check plugin/com.taehyeong.streamdock.claudeusage.sdPlugin/plugin/index.js
node --test tests/helpers.test.js
python3 -m pytest tests/ -q
```
Expected: `node --check` 무출력(성공), node 6 pass, pytest 16 passed.

- [ ] **Step 8: 커밋**

```bash
cd ~/streamdock-claude-usage
git add plugin/com.taehyeong.streamdock.claudeusage.sdPlugin
git commit -m "feat(plugin): Gemini 주간 게이지·리셋 액션 신설 (12→14 액션)

기존 gemini/geminiReset UUID는 유지하고 표시명만 'Gemini 5h'로 바꿔
덱에 배치된 버튼이 깨지지 않게 한다(둘 다 이미 5h 데이터였다).
조회는 pickMetric으로 gemini_5h → gemini 폴백."
```

---

### Task 5: 설치·실기기 검증·문서 갱신

**Files:**
- Modify: `README.md` (액션 수·목록)

**Interfaces:**
- Consumes: Task 1~4 전부
- Produces: 없음 (배포 및 검증)

- [ ] **Step 1: 설치**

Run: `cd ~/streamdock-claude-usage && bash install.sh`
Expected: 플러그인 디렉토리로 복사 성공 메시지.

- [ ] **Step 2: MONSTAR DECK 앱 재시작 요청**

사용자에게 MONSTAR DECK 앱을 재시작해달라고 요청한다 (액션 목록은 앱 기동 시 manifest에서 읽으므로 재시작 없이는 신규 액션 2개가 목록에 안 뜬다).

- [ ] **Step 3: 플러그인 런타임에서 데이터 확인**

Run:
```bash
curl -s http://127.0.0.1:23519/json | python3 -c "
import json,sys
for t in json.load(sys.stdin):
    if 'claudeusage' in (t.get('url') or ''):
        print(t['title']); print(t['webSocketDebuggerUrl'])
"
```
Expected: 플러그인 페이지의 webSocketDebuggerUrl 출력. (CEF remote-debugging-port 23519가 열려 있다.)

빈 출력이면 앱이 아직 안 떴거나 플러그인이 로드되지 않은 것 — Step 2로 돌아간다.

- [ ] **Step 4: 육안 검증**

사용자에게 확인 요청:
- 액션 목록에 `Gemini 주간`, `Gemini 주간 리셋`이 보이는가
- 기존에 배치해둔 Gemini 버튼이 그대로 살아 있고 라벨이 `Gemini 5h`인가
- 두 게이지가 서로 다른 값을 보이는가 (5h는 리셋 경과 시 100%, 주간은 88 근방)

- [ ] **Step 5: README 갱신**

`README.md`에서 액션 수를 12에서 14로, Gemini 항목을 `Gemini 5h` + `Gemini 주간`(게이지 6 + 리셋 6 + 캐릭터 2)으로 갱신한다. 실제 문구는 파일의 기존 서술 형식을 그대로 따른다.

- [ ] **Step 6: 커밋**

```bash
cd ~/streamdock-claude-usage
git add README.md
git commit -m "docs: Gemini 2축 분리 반영 (액션 12→14)"
```

---

## Self-Review

**1. 스펙 커버리지**

| 스펙 요구 | 태스크 |
|---|---|
| `gemini_5h`/`gemini_7d` 키 추가 | Task 1 |
| legacy `gemini` 키 존치 | Task 1 Step 3 + `test_gemini_legacy_key_stays_5h` |
| `_codex_metric` → `_snapshot_metric` 일반화 | Task 1 Step 3 |
| `pct_weekly=None` → `—` 렌더 | Task 1 `test_gemini_weekly_null_pct` (플러그인 측은 기존 로직 그대로) |
| vendored 사본 2곳 동기 패치 | Task 1 + Task 2 (Step 3에서 대조) |
| UUID 유지, 표시명만 변경 | Task 4 Step 1·2 + Step 4 검증 스크립트 |
| 신규 액션 2개 | Task 4 |
| 폴백 1줄 | Task 3 + Task 4 Step 5·6 |
| 4개 파일 반영(manifest×2, 로케일×2) | Task 4 Step 1~3 |
| 테스트 확장 | Task 1 Step 1, Task 3 Step 1 |
| 배포 순서 | Task 2 Step 4 → Task 5 Step 1·2 |

**2. 플레이스홀더 스캔** — 없음. Task 5 Step 5의 README 문구만 "기존 형식을 따른다"로 열려 있는데, 이건 산문 편집이라 코드 계약이 아니다.

**3. 타입 정합성** — `_snapshot_metric` 시그니처는 repo(5인자, `now_ts` 명시)와 NERV(4인자, `now_ts` 클로저)가 다르다. **의도적**이다: NERV 사본은 `_write_streamdock_usage` 안의 중첩 함수라 `now_ts`가 이미 스코프에 있다. Task 2 Step 1에 그 형태로 명시했다. `pickMetric(u, metric)`은 Task 3 정의와 Task 4 사용처가 일치한다. `fallbackKey` 속성명도 Task 3 테스트와 Task 4 METRICS에서 동일하다.
