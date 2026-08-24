# Gemini 5h/주간 창 분리 — 설계

- 날짜: 2026-08-24
- 상태: 승인됨 (PI)
- 관련: `docs/superpowers/specs/2026-07-15-streamdock-claude-usage-design.md`

## 배경

덱의 Gemini 게이지는 액션 1개뿐이고, 그 값은 `token_status_data.js`의
`gemini.pct_used` / `gemini.reset`에서 온다.

수집기(`token_collector.py:1488-1512`, NERV)는 2026-08-23 agy statusline tee
경로 신설 이후 **5h와 주간을 이미 분리해서 싣고 있다**:

| 키 | 의미 |
|---|---|
| `pct_used` / `reset` | legacy alias — **5h 값과 동일** (기존 소비자 호환용) |
| `pct_5h` / `reset_5h` / `reset_5h_at` | 5h 창 |
| `pct_weekly` / `reset_weekly` / `reset_weekly_at` | 주간 창 |

즉 덱이 legacy alias를 읽고 있으므로 **현재 표시되는 축은 5h이고, 빠져 있는
것은 주간**이다. 라이브 실측(2026-08-24):

```
pct_used = 20        reset = '14:51 KST'
pct_5h   = 20        reset_5h = '14:51 KST'          ← 동일
pct_weekly = 12      reset_weekly = '08/26 23:00 KST' ← 덱에 미전달
```

### 5h가 주간처럼 보였던 이유 (부수 버그)

agy 원장은 agy가 호출될 때만 갱신된다(실측 `age_sec=36384`, `agy_calls_today=0`).
`reset_5h_at`은 약 6시간 전에 지났는데 Gemini 지표는 `stale=False` 하드코딩에
리셋-경과 보정도 없어서, 게이지가 80% / 리셋 "14:51"인 채로 얼어 있었다.
5h 창인데 하루 종일 안 움직이니 주간 창으로 읽힌다.

Codex 스냅샷도 같은 성질(CLI 실행 시에만 갱신)이라 `_codex_metric`의 리셋-경과
보정으로 이미 교정돼 있다. Gemini에는 그 규율이 적용되지 않았다.

## 목표

1. Gemini를 Claude/Codex와 동일하게 **5h·주간 2축**으로 덱에 노출한다.
2. 두 축 모두에 **리셋-경과 보정**을 적용해 얼어붙은 게이지를 없앤다.

## 비목표

- `token_collector.py` 변경 — 필요한 데이터가 이미 전부 있다. 여기를 고치고
  있다면 스코프를 벗어난 것이다.
- age 기반 stale 표시 (statusline_tee 고장 카나리아) — 검토했으나 PI 판단으로
  제외. 창이 안 끝났으면 묵은 값도 정확하다는 스냅샷 규율상 dim은 노이즈다.
- 캐릭터 액션 — `PROVIDER_KEYS`(`plugin/index.js:138`)에 gemini가 없어 무관.
- Claude/Codex 경로.

## 설계

### 1. 데이터 계층

페이로드에 키 2개를 추가하고 legacy 키는 존치한다.

```
gemini_5h : pct_5h     / reset_5h     / reset_5h_at
gemini_7d : pct_weekly / reset_weekly / reset_weekly_at
gemini    : pct_used   / reset               (기존 그대로 = 5h)
```

- 형제 키(`claude_7d`, `codex_7d`)와 맞춰 주간은 `gemini_7d`로 명명한다.
  (수집기 쪽 이름은 `weekly`지만 페이로드 스키마 일관성을 우선한다.)
- **legacy `gemini` 키 존치 이유**: writer(NERV)와 플러그인(StreamDock)은
  배포 시점이 다르다. 구 플러그인 + 신 writer 조합에서 게이지가 죽지 않아야
  한다. 수집기가 `pct_used` alias를 남긴 것과 같은 이유다.
- `_codex_metric` → `_snapshot_metric`으로 이름을 일반화하고 Gemini 두 축에
  재사용한다. 이 함수는 Codex 전용이 아니라 "스냅샷형 프로바이더"(CLI/agy가
  돌 때만 갱신 → 창이 지나면 새 창이고 사용 0) 공통 규율이다.
- `pct_weekly`가 `None`인데 `available=True`인 경우가 가능하다. 이때
  `rem=null`이 되고 플러그인은 기존 로직으로 `—`를 렌더한다
  (`plugin/index.js:50,79` — Claude의 `pct_7d=None` 처리와 동일).

**패치 대상이 둘이다.** 두 파일은 서로를 import하지 않고 로직을 각자 들고 있다:

| 파일 | 역할 |
|---|---|
| `writer/usage_payload.py` | repo의 테스트되는 사본 |
| NERV `project-dashboard/token_status_writer.py:102` | **라이브 파일을 실제로 쓰는 쪽** (vendored 사본) |

NERV 쪽 `_codex_metric`은 `codex`를 클로저로 잡고 있으므로 `prov`를 인자로
받도록 일반화해야 한다.

### 2. 플러그인 계층

- 기존 `…claudeusage.gemini` / `…claudeusage.geminiReset` **UUID는 유지**하고
  표시명만 `Gemini 5h`로 바꾼다. UUID를 바꾸면 덱에 이미 배치해둔 물리 버튼이
  깨진다. 두 액션 모두 이미 5h 데이터를 보여주고 있으므로 의미도 맞다.
- 신규 UUID 2개: `…claudeusage.geminiWeekly`(gauge),
  `…claudeusage.geminiWeeklyReset`(reset). 액션 12 → 14.
- `METRICS` 맵(`plugin/index.js:6-19`)의 gemini 항목 `key`를 `gemini_5h`로
  바꾸고, 구 `gemini` 키로 떨어지는 **폴백 1줄**을 둔다. 플러그인만 먼저
  설치되고 writer가 아직 구버전인 구간에서 게이지가 죽지 않게 한다.
- 반영 파일: `manifest.json`, `manifest.elgato.json`, `en.json`, `ko.json`,
  `plugin/index.js`.
- accent 색은 기존 Gemini와 동일한 `#4285F4`.

### 3. 테스트

`tests/test_usage_payload.py` 확장:

- `gemini_5h` / `gemini_7d` 정상값 (rem = 100 - pct)
- 리셋 경과 보정: `reset_5h_at <= now` → `rem=100`, `reset=""`
- 미래 리셋은 무보정
- `pct_weekly=None` → `rem=None`, `available`은 그대로
- legacy `gemini` 키가 5h와 동일하게 유지되는지
- 기존 `test_gemini_single_metric` / `test_codex_gemini_never_stale_flag`는
  legacy 키 존치로 그대로 통과해야 한다 (회귀 감시용으로 남긴다).

### 4. 배포 순서

역순이면 스키마 스큐로 깨진다.

```
1. NERV token_status_writer.py 패치
2. launchctl kickstart -k gui/501/com.nerv.agent-monitor
   (장기 실행 데몬 — 재시작 없이는 옛 코드가 메모리에 남는다)
3. usage.json에 gemini_5h/gemini_7d가 실제로 찍히는지 확인
4. bash install.sh
5. MONSTAR DECK 앱 재시작
```

## 검증

- `pytest tests/test_usage_payload.py` 전건 통과
- 라이브 `usage.json`에 `gemini_5h`(rem 100, reset "") + `gemini_7d`(rem 88,
  reset "08/26 23:00") 확인 — 실측 시점 기준 기대값이며 창 경계에 따라 변한다
- 덱에서 Gemini 5h / Gemini 주간 게이지 + 리셋 버튼 4종 육안 확인
