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
