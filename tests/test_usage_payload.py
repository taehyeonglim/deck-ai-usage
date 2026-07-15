import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'writer'))
from usage_payload import build_payload

TOKEN = {
    "claude": {"available": True, "pct_5h": 5, "pct_7d": 24,
               "reset_5h": "07/16 00:00 KST", "reset_7d": "07/20 19:00 KST",
               "pct_source": "cache", "pct_stale_min": 14},
    "codex": {"available": True, "pct_5h": 13, "pct_7d": 0,
              "reset_5h": "07/22 07:23 KST", "reset_7d": None},
    "gemini": {"available": True, "pct_used": 0, "reset": "07/17 00:31 KST"},
}


def test_claude_rem_is_100_minus_pct():
    p = build_payload(TOKEN, 1752620472)
    assert p["claude_5h"]["rem"] == 95 and p["claude_7d"]["rem"] == 76


def test_codex_rem_both_windows():
    p = build_payload(TOKEN, 0)
    assert p["codex_5h"]["rem"] == 87 and p["codex_7d"]["rem"] == 100  # 100-13, 100-0


def test_gemini_single_metric():
    p = build_payload(TOKEN, 0)
    assert p["gemini"]["rem"] == 100 and p["gemini"]["reset"] == "07/17 00:31"
    assert p["gemini"]["available"] is True


def test_reset_trimmed_and_null():
    p = build_payload(TOKEN, 0)
    assert p["claude_5h"]["reset"] == "07/16 00:00"
    assert p["codex_7d"]["reset"] == ""  # reset_7d None → ""


def test_claude_stale_threshold():
    assert build_payload(TOKEN, 0)["claude_5h"]["stale"] is False  # 14 < 15
    t = {"claude": dict(TOKEN["claude"], pct_stale_min=15)}
    assert build_payload(t, 0)["claude_5h"]["stale"] is True


def test_codex_gemini_never_stale_flag():
    p = build_payload(TOKEN, 0)
    assert p["codex_5h"]["stale"] is False and p["gemini"]["stale"] is False


def test_clamp_and_none():
    t = {"claude": dict(TOKEN["claude"], pct_5h=130, pct_7d=None)}
    p = build_payload(t, 0)
    assert p["claude_5h"]["rem"] == 0 and p["claude_7d"]["rem"] is None


def test_missing_provider_is_unavailable():
    p = build_payload({"claude": TOKEN["claude"]}, 7)  # no codex/gemini
    assert p["codex_5h"]["available"] is False and p["codex_5h"]["rem"] is None
    assert p["gemini"]["available"] is False
    assert p["ts"] == 7


def test_available_passthrough():
    t = {"claude": dict(TOKEN["claude"], available=False)}
    assert build_payload(t, 0)["claude_5h"]["available"] is False
