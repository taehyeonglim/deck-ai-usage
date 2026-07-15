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
