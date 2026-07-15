let ws = null;
// context -> metric descriptor (which provider/window this key shows)
const contexts = new Map();

// 액션 UUID -> 지표. 각 버튼이 한 지표를 전담한다.
const METRICS = {
  "com.taehyeong.streamdock.claudeusage.claude5h": { key: "claude_5h", label: "Claude 5h", accent: "#D77757" },
  "com.taehyeong.streamdock.claudeusage.claude7d": { key: "claude_7d", label: "Claude 주간", accent: "#D77757" },
  "com.taehyeong.streamdock.claudeusage.codex5h":  { key: "codex_5h",  label: "Codex 5h",  accent: "#10A37F" },
  "com.taehyeong.streamdock.claudeusage.codex7d":  { key: "codex_7d",  label: "Codex 주간", accent: "#10A37F" },
  "com.taehyeong.streamdock.claudeusage.gemini":   { key: "gemini",    label: "Gemini",    accent: "#4285F4" },
};

// 덱이 이 함수를 호출한다 (Elgato SDK 진입점)
function connectElgatoStreamDeckSocket(port, uuid, registerEvent, info) {
  ws = new WebSocket("ws://127.0.0.1:" + port);
  ws.onopen = () => ws.send(JSON.stringify({ uuid, event: registerEvent }));
  ws.onmessage = (e) => {
    const d = JSON.parse(e.data);
    if (d.event === "willAppear") {
      const metric = METRICS[d.action];
      if (metric) { contexts.set(d.context, metric); renderAll(); }
    } else if (d.event === "willDisappear") {
      contexts.delete(d.context);
    }
  };
}

function setImage(context, dataURL) {
  ws && ws.send(JSON.stringify({ event: "setImage", context, payload: { target: 0, image: dataURL } }));
}

async function fetchUsage() {
  const res = await fetch("./data/usage.json?ts=" + Date.now());
  return await res.json();
}

// 단일 지표 게이지 (풀사이즈 링 + 중앙 % + 라벨 + 리셋 + 프로바이더 액센트)
function drawSingleGauge(ctx, metric, u, nowMs) {
  const W = 144, cx = 72, cy = 74, r = 44;
  const data = u ? u[metric.key] : null;
  const fileTs = u ? u.ts : 0;
  const avail = !!(data && data.available !== false && data.rem != null);
  const rem = avail ? data.rem : null;
  const stale = CU.isStaleData({ stale: !!(data && data.stale === true), ts: fileTs }, nowMs);

  ctx.clearRect(0, 0, W, W);
  ctx.fillStyle = "#0D1117"; ctx.fillRect(0, 0, W, W);

  // 상단 라벨 (프로바이더 액센트)
  ctx.textAlign = "center"; ctx.textBaseline = "top";
  ctx.font = "bold 14px sans-serif";
  ctx.fillStyle = metric.accent;
  ctx.fillText(metric.label, cx, 10);
  // 얇은 액센트 바
  ctx.fillRect(cx - 20, 28, 40, 2);

  // 링 트랙
  ctx.lineWidth = 12; ctx.lineCap = "round";
  ctx.strokeStyle = "#21262D";
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();

  // 링 채움 — 12시 시작 시계방향, 남은 비율
  if (avail) {
    const start = -Math.PI / 2;
    const end = start + (Math.PI * 2) * (rem / 100);
    ctx.strokeStyle = CU.ringColor(rem);
    if (stale) ctx.globalAlpha = 0.35;
    ctx.beginPath(); ctx.arc(cx, cy, r, start, end); ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // 중앙 남은 %
  ctx.fillStyle = stale ? "#6E7681" : "#E6EDF3";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.font = "bold 33px sans-serif";
  ctx.fillText(avail ? rem + "%" : "—", cx, cy);

  // 하단 리셋 시각
  ctx.font = "10px sans-serif"; ctx.fillStyle = "#8B949E";
  ctx.textBaseline = "bottom";
  ctx.fillText(data && data.reset ? "↺ " + data.reset : "", cx, W - 8);

  // stale 점
  if (stale) { ctx.fillStyle = "#D29922"; ctx.beginPath(); ctx.arc(134, 12, 5, 0, Math.PI * 2); ctx.fill(); }

  return ctx.canvas.toDataURL("image/png");
}

async function renderAll() {
  if (contexts.size === 0) return;
  let u = null;
  try { u = await fetchUsage(); } catch (err) { console.log("[CU] fetch FAILED", String(err)); }
  const ctx = document.getElementById("c").getContext("2d");
  const now = Date.now();
  contexts.forEach((metric, context) => {
    const img = drawSingleGauge(ctx, metric, u, now);
    setImage(context, img);
  });
}

// 30초 주기 자동 갱신
const worker = new Worker("timer.worker.js");
worker.onmessage = () => renderAll();
worker.postMessage({ event: "start", delay: 30000 });
