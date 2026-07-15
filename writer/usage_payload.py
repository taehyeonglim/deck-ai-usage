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
