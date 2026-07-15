let ws = null;
// context -> metric descriptor (which provider/window this key shows)
const contexts = new Map();

// 액션 UUID -> 지표. mode "gauge"=남은% 링, "reset"=리셋 시각.
const METRICS = {
  "com.taehyeong.streamdock.claudeusage.claude5h": { key: "claude_5h", label: "Claude 5h", accent: "#D77757", mode: "gauge" },
  "com.taehyeong.streamdock.claudeusage.claude7d": { key: "claude_7d", label: "Claude 주간", accent: "#D77757", mode: "gauge" },
  "com.taehyeong.streamdock.claudeusage.codex5h":  { key: "codex_5h",  label: "Codex 5h",  accent: "#10A37F", mode: "gauge" },
  "com.taehyeong.streamdock.claudeusage.codex7d":  { key: "codex_7d",  label: "Codex 주간", accent: "#10A37F", mode: "gauge" },
  "com.taehyeong.streamdock.claudeusage.gemini":   { key: "gemini",    label: "Gemini",    accent: "#4285F4", mode: "gauge" },
  "com.taehyeong.streamdock.claudeusage.claude5hReset": { key: "claude_5h", label: "Claude 5h", accent: "#D77757", mode: "reset" },
  "com.taehyeong.streamdock.claudeusage.claude7dReset": { key: "claude_7d", label: "Claude 주간", accent: "#D77757", mode: "reset" },
  "com.taehyeong.streamdock.claudeusage.codex5hReset":  { key: "codex_5h",  label: "Codex 5h",  accent: "#10A37F", mode: "reset" },
  "com.taehyeong.streamdock.claudeusage.codex7dReset":  { key: "codex_7d",  label: "Codex 주간", accent: "#10A37F", mode: "reset" },
  "com.taehyeong.streamdock.claudeusage.geminiReset":   { key: "gemini",    label: "Gemini",    accent: "#4285F4", mode: "reset" },
  "com.taehyeong.streamdock.claudeusage.character":     { key: "claude_7d", label: "Claude",     accent: "#D77757", mode: "anim" },
};

// 덱이 이 함수를 호출한다 (Elgato SDK 진입점)
function connectElgatoStreamDeckSocket(port, uuid, registerEvent, info) {
  ws = new WebSocket("ws://127.0.0.1:" + port);
  ws.onopen = () => ws.send(JSON.stringify({ uuid, event: registerEvent }));
  ws.onmessage = (e) => {
    const d = JSON.parse(e.data);
    if (d.event === "willAppear") {
      const metric = METRICS[d.action];
      if (metric) { contexts.set(d.context, metric); updateAnimTimer(); renderAll(); }
    } else if (d.event === "willDisappear") {
      contexts.delete(d.context); updateAnimTimer();
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

// 리셋 시각 전용 (링 없이 ↺ + 날짜/시각)
function drawReset(ctx, metric, u, nowMs) {
  const W = 144;
  const data = u ? u[metric.key] : null;
  const fileTs = u ? u.ts : 0;
  const avail = !!(data && data.available !== false);
  const reset = data && data.reset ? String(data.reset) : "";
  const stale = CU.isStaleData({ stale: !!(data && data.stale === true), ts: fileTs }, nowMs);

  ctx.clearRect(0, 0, W, W);
  ctx.fillStyle = "#0D1117"; ctx.fillRect(0, 0, W, W);

  // 상단 라벨 (프로바이더 액센트) + 액센트 바
  ctx.textAlign = "center"; ctx.textBaseline = "top";
  ctx.font = "bold 14px sans-serif";
  ctx.fillStyle = metric.accent;
  ctx.fillText(metric.label, W / 2, 10);
  ctx.fillRect(W / 2 - 20, 28, 40, 2);

  // ↺ 리셋 아이콘
  ctx.font = "24px sans-serif";
  ctx.fillStyle = stale ? "#6E7681" : "#8B949E";
  ctx.textBaseline = "middle";
  ctx.fillText("↺", W / 2, 52);

  ctx.fillStyle = stale ? "#6E7681" : "#E6EDF3";
  if (!avail || !reset) {
    ctx.font = "bold 30px sans-serif";
    ctx.fillText("—", W / 2, 92);
    ctx.font = "10px sans-serif"; ctx.fillStyle = "#8B949E"; ctx.textBaseline = "bottom";
    ctx.fillText(avail ? "리셋 정보 없음" : "연동 대기", W / 2, W - 8);
  } else {
    const parts = reset.split(" ");
    if (parts.length >= 2) {
      ctx.font = "bold 23px sans-serif"; ctx.fillText(parts[0], W / 2, 88);   // 날짜
      ctx.font = "bold 27px sans-serif"; ctx.fillText(parts[1], W / 2, 118);  // 시각
    } else {
      ctx.font = "bold 32px sans-serif"; ctx.fillText(parts[0], W / 2, 100);  // 시각만
    }
  }

  if (stale) { ctx.fillStyle = "#D29922"; ctx.beginPath(); ctx.arc(134, 12, 5, 0, Math.PI * 2); ctx.fill(); }

  return ctx.canvas.toDataURL("image/png");
}

// ─── 사용량 반응형 캐릭터 ──────────────────────────────────────
let lastUsage = null;   // 30초 fetch 캐시 (애니메이션이 재fetch 없이 재사용)
let animFrame = 0;

// Claude 남은 에너지 = 5h/7d 중 더 빡빡한 쪽 (둘 다 없으면 null)
function claudeEnergy(u) {
  if (!u) return null;
  const vals = [];
  for (const k of ["claude_5h", "claude_7d"]) {
    const m = u[k];
    if (m && m.available !== false && m.rem != null) vals.push(m.rem);
  }
  return vals.length ? Math.min.apply(null, vals) : null;
}

function drawSleeping(ctx, cx, t) {
  const cy = 74;
  ctx.fillStyle = "#5A5A5A";
  ctx.beginPath(); ctx.arc(cx, cy, 30, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "#1A1A1A"; ctx.lineWidth = 2.5; ctx.lineCap = "round";
  ctx.beginPath(); ctx.arc(cx - 10, cy - 3, 4, 0.1 * Math.PI, 0.9 * Math.PI); ctx.stroke();
  ctx.beginPath(); ctx.arc(cx + 10, cy - 3, 4, 0.1 * Math.PI, 0.9 * Math.PI); ctx.stroke();
  const zp = Math.floor(t) % 3;
  ctx.fillStyle = "#8B949E"; ctx.textAlign = "left";
  ctx.font = "bold 14px sans-serif"; ctx.fillText("z", cx + 22, cy - 18 - zp * 4);
  ctx.font = "bold 11px sans-serif"; ctx.fillText("z", cx + 31, cy - 28 - zp * 3);
  ctx.fillStyle = "#8B949E"; ctx.font = "11px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
  ctx.fillText("연동 대기", cx, 138);
}

// 사용량 반응 캐릭터 한 프레임 — 여유↑ 신나게 통통, 부족↓ 지쳐 늘어짐
function drawCharacter(ctx, metric, u, frame) {
  const W = 144, cx = 72;
  const t = frame * 0.1;
  ctx.clearRect(0, 0, W, W);
  ctx.fillStyle = "#0D1117"; ctx.fillRect(0, 0, W, W);

  const energy = claudeEnergy(u);
  if (energy == null) { drawSleeping(ctx, cx, t); return ctx.canvas.toDataURL("image/png"); }

  const e = energy / 100;                          // 0..1
  const bounce = Math.sin(t * (2 + e * 4)) * (2 + e * 10);
  const cy = 70 + bounce + (1 - e) * 12;           // 지치면 아래로 처짐
  const spin = t * (0.3 + e * 1.6);                // 스파클 회전 (에너지↑ 빠르게)
  const R = 30;
  const coral = e > 0.5 ? "#D77757" : e > 0.2 ? "#C08466" : "#8B7268";

  // 스파클 광선 (회전)
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(spin);
  ctx.strokeStyle = coral; ctx.lineCap = "round"; ctx.lineWidth = 4;
  ctx.globalAlpha = 0.5 + e * 0.4;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const len = R + 12 + Math.sin(t * 3 + i) * (2 + e * 4);
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * (R + 2), Math.sin(a) * (R + 2));
    ctx.lineTo(Math.cos(a) * len, Math.sin(a) * len);
    ctx.stroke();
  }
  ctx.restore(); ctx.globalAlpha = 1;

  // 몸통
  ctx.fillStyle = coral;
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();

  // 눈
  const eyeY = cy - 4, dx = 10;
  if (e < 0.2) {                                    // 지친 눈 (^ ^ 늘어짐)
    ctx.strokeStyle = "#1A1A1A"; ctx.lineWidth = 2.5; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(cx - dx - 4, eyeY - 1); ctx.lineTo(cx - dx + 3, eyeY + 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx + dx - 3, eyeY + 2); ctx.lineTo(cx + dx + 4, eyeY - 1); ctx.stroke();
  } else {                                          // 초롱초롱 (가끔 깜빡)
    const blink = (frame % 45) < 2 ? 0.12 : 1;
    ctx.fillStyle = "#1A1A1A";
    ctx.beginPath(); ctx.ellipse(cx - dx, eyeY, 3.5, 4.5 * blink, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(cx + dx, eyeY, 3.5, 4.5 * blink, 0, 0, Math.PI * 2); ctx.fill();
    if (blink === 1) {
      ctx.fillStyle = "#fff";
      ctx.beginPath(); ctx.arc(cx - dx + 1.2, eyeY - 1.5, 1, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(cx + dx + 1.2, eyeY - 1.5, 1, 0, Math.PI * 2); ctx.fill();
    }
  }

  // 입
  ctx.strokeStyle = "#1A1A1A"; ctx.lineWidth = 2.5; ctx.lineCap = "round"; ctx.beginPath();
  if (e > 0.5) ctx.arc(cx, cy + 5, 7, 0.15 * Math.PI, 0.85 * Math.PI);          // 활짝
  else if (e > 0.2) { ctx.moveTo(cx - 5, cy + 9); ctx.lineTo(cx + 5, cy + 9); } // 무표정
  else ctx.arc(cx, cy + 15, 7, 1.15 * Math.PI, 1.85 * Math.PI);                 // 시무룩
  ctx.stroke();

  if (e < 0.2) {                                    // 지치면 땀방울
    ctx.fillStyle = "#58A6FF";
    const sy = cy - 16 + (Math.sin(t * 2) + 1) * 3;
    ctx.beginPath(); ctx.arc(cx + R - 5, sy, 3, 0, Math.PI * 2); ctx.fill();
  }

  // 라벨
  ctx.fillStyle = "#8B949E"; ctx.font = "11px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
  ctx.fillText("Claude " + energy + "%", cx, W - 6);

  return ctx.canvas.toDataURL("image/png");
}

function hasAnimContext() {
  for (const m of contexts.values()) if (m.mode === "anim") return true;
  return false;
}

// 캐릭터 버튼이 있을 때만 빠른 애니메이션 타이머 가동
function updateAnimTimer() {
  if (hasAnimContext()) worker.postMessage({ event: "start", name: "anim", delay: 100 });
  else worker.postMessage({ event: "stop", name: "anim" });
}

function animTick() {
  animFrame++;
  const ctx = document.getElementById("c").getContext("2d");
  contexts.forEach((metric, context) => {
    if (metric.mode !== "anim") return;
    setImage(context, drawCharacter(ctx, metric, lastUsage, animFrame));
  });
}

async function renderAll() {
  if (contexts.size === 0) return;
  let u = null;
  try { u = await fetchUsage(); } catch (err) { console.log("[CU] fetch FAILED", String(err)); }
  lastUsage = u;
  const ctx = document.getElementById("c").getContext("2d");
  const now = Date.now();
  contexts.forEach((metric, context) => {
    let img;
    if (metric.mode === "reset") img = drawReset(ctx, metric, u, now);
    else if (metric.mode === "anim") img = drawCharacter(ctx, metric, u, animFrame);
    else img = drawSingleGauge(ctx, metric, u, now);
    setImage(context, img);
  });
}

// 데이터 30초 + 애니메이션(캐릭터 배치 시에만 100ms) 타이머
const worker = new Worker("timer.worker.js");
worker.onmessage = ({ data }) => { if (data && data.name === "anim") animTick(); else renderAll(); };
worker.postMessage({ event: "start", name: "data", delay: 30000 });
