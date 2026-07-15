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
