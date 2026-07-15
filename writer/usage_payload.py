"""token_status_data.js(claude/codex/gemini) → 덱 플러그인 usage.json 페이로드 (순수 함수).

5지표 중첩 스키마: claude_5h, claude_7d, codex_5h, codex_7d, gemini (각 {rem,reset,stale,available})
+ 최상위 ts. rem = 100 - pct (사용량 → 남은%).
"""

def _rem(p):
    try:
        return max(0, min(100, round(100 - float(p))))
    except (TypeError, ValueError):
        return None

def _trim_reset(s):
    if not s:
        return ""
    return str(s).replace(" KST", "").strip()

def _metric(prov, pct_key, reset_key, stale):
    prov = prov or {}
    return {
        "rem": _rem(prov.get(pct_key)),
        "reset": _trim_reset(prov.get(reset_key)),
        "stale": bool(stale),
        "available": bool(prov.get("available", False)),
    }

def build_payload(token_data, now_ts):
    td = token_data or {}
    claude = td.get("claude") or {}
    codex = td.get("codex") or {}
    gemini = td.get("gemini") or {}
    claude_stale = bool(claude.get("pct_source") == "cache"
                        and (claude.get("pct_stale_min") or 0) >= 15)
    return {
        "claude_5h": _metric(claude, "pct_5h", "reset_5h", claude_stale),
        "claude_7d": _metric(claude, "pct_7d", "reset_7d", claude_stale),
        "codex_5h": _metric(codex, "pct_5h", "reset_5h", False),
        "codex_7d": _metric(codex, "pct_7d", "reset_7d", False),
        "gemini": _metric(gemini, "pct_used", "reset", False),
        "ts": int(now_ts),
    }
