let ws = null;
// context -> metric descriptor (which provider/window this key shows)
const contexts = new Map();

// 액션 UUID -> 지표. mode "gauge"=남은% 링, "reset"=리셋 시각, "anim"=캐릭터.
const METRICS = {
  "com.taehyeong.streamdock.claudeusage.claude5h": { key: "claude_5h", label: "Claude 5h", accent: "#D77757", mode: "gauge" },
  "com.taehyeong.streamdock.claudeusage.claude7d": { key: "claude_7d", label: "Claude 주간", accent: "#D77757", mode: "gauge" },
  "com.taehyeong.streamdock.claudeusage.codex5h":  { key: "codex_5h",  label: "Codex 5h",  accent: "#10A37F", mode: "gauge" },
  "com.taehyeong.streamdock.claudeusage.codex7d":  { key: "codex_7d",  label: "Codex 주간", accent: "#10A37F", mode: "gauge" },
  "com.taehyeong.streamdock.claudeusage.gemini":        { key: "gemini_5h", fallbackKey: "gemini", label: "Gemini 5h", accent: "#4285F4", mode: "gauge" },
  "com.taehyeong.streamdock.claudeusage.geminiWeekly":  { key: "gemini_7d", label: "Gemini 주간", accent: "#4285F4", mode: "gauge" },
  "com.taehyeong.streamdock.claudeusage.claude5hReset": { key: "claude_5h", label: "Claude 5h", accent: "#D77757", mode: "reset" },
  "com.taehyeong.streamdock.claudeusage.claude7dReset": { key: "claude_7d", label: "Claude 주간", accent: "#D77757", mode: "reset" },
  "com.taehyeong.streamdock.claudeusage.codex5hReset":  { key: "codex_5h",  label: "Codex 5h",  accent: "#10A37F", mode: "reset" },
  "com.taehyeong.streamdock.claudeusage.codex7dReset":  { key: "codex_7d",  label: "Codex 주간", accent: "#10A37F", mode: "reset" },
  "com.taehyeong.streamdock.claudeusage.geminiReset":       { key: "gemini_5h", fallbackKey: "gemini", label: "Gemini 5h", accent: "#4285F4", mode: "reset" },
  "com.taehyeong.streamdock.claudeusage.geminiWeeklyReset": { key: "gemini_7d", label: "Gemini 주간", accent: "#4285F4", mode: "reset" },
  "com.taehyeong.streamdock.claudeusage.character":      { label: "Claude", provider: "claude", mode: "anim" },
  "com.taehyeong.streamdock.claudeusage.codexCharacter": { label: "Codex",  provider: "codex",  mode: "anim" },
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
  const data = CU.pickMetric(u, metric);
  const fileTs = u ? u.ts : 0;
  const avail = !!(data && data.available !== false && data.rem != null);
  const rem = avail ? data.rem : null;
  const stale = CU.isStaleData({ stale: !!(data && data.stale === true), ts: fileTs }, nowMs);

  ctx.clearRect(0, 0, W, W);
  ctx.fillStyle = "#0D1117"; ctx.fillRect(0, 0, W, W);

  ctx.textAlign = "center"; ctx.textBaseline = "top";
  ctx.font = "bold 14px sans-serif";
  ctx.fillStyle = metric.accent;
  ctx.fillText(metric.label, cx, 10);
  ctx.fillRect(cx - 20, 28, 40, 2);

  ctx.lineWidth = 12; ctx.lineCap = "round";
  ctx.strokeStyle = "#21262D";
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();

  if (avail) {
    const start = -Math.PI / 2;
    const end = start + (Math.PI * 2) * (rem / 100);
    ctx.strokeStyle = CU.ringColor(rem);
    if (stale) ctx.globalAlpha = 0.35;
    ctx.beginPath(); ctx.arc(cx, cy, r, start, end); ctx.stroke();
    ctx.globalAlpha = 1;
  }

  ctx.fillStyle = stale ? "#6E7681" : "#E6EDF3";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.font = "bold 33px sans-serif";
  ctx.fillText(avail ? rem + "%" : "—", cx, cy);

  ctx.font = "10px sans-serif"; ctx.fillStyle = "#8B949E";
  ctx.textBaseline = "bottom";
  ctx.fillText(data && data.reset ? "↺ " + data.reset : "", cx, W - 8);

  if (stale) { ctx.fillStyle = "#D29922"; ctx.beginPath(); ctx.arc(134, 12, 5, 0, Math.PI * 2); ctx.fill(); }

  return ctx.canvas.toDataURL("image/png");
}

// 리셋 시각 전용 (링 없이 ↺ + 날짜/시각)
function drawReset(ctx, metric, u, nowMs) {
  const W = 144;
  const data = CU.pickMetric(u, metric);
  const fileTs = u ? u.ts : 0;
  const avail = !!(data && data.available !== false);
  const reset = data && data.reset ? String(data.reset) : "";
  const stale = CU.isStaleData({ stale: !!(data && data.stale === true), ts: fileTs }, nowMs);

  ctx.clearRect(0, 0, W, W);
  ctx.fillStyle = "#0D1117"; ctx.fillRect(0, 0, W, W);

  ctx.textAlign = "center"; ctx.textBaseline = "top";
  ctx.font = "bold 14px sans-serif";
  ctx.fillStyle = metric.accent;
  ctx.fillText(metric.label, W / 2, 10);
  ctx.fillRect(W / 2 - 20, 28, 40, 2);

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
      ctx.font = "bold 23px sans-serif"; ctx.fillText(parts[0], W / 2, 88);
      ctx.font = "bold 27px sans-serif"; ctx.fillText(parts[1], W / 2, 118);
    } else {
      ctx.font = "bold 32px sans-serif"; ctx.fillText(parts[0], W / 2, 100);
    }
  }

  if (stale) { ctx.fillStyle = "#D29922"; ctx.beginPath(); ctx.arc(134, 12, 5, 0, Math.PI * 2); ctx.fill(); }

  return ctx.canvas.toDataURL("image/png");
}

// ─── 사용량 반응형 캐릭터 ──────────────────────────────────────
let lastUsage = null;   // 30초 fetch 캐시 (애니메이션이 재fetch 없이 재사용)
let animFrame = 0;

const PROVIDER_KEYS = { claude: ["claude_5h", "claude_7d"], codex: ["codex_5h", "codex_7d"] };

// 남은 에너지 = 해당 프로바이더 창들 중 더 빡빡한 쪽 (없으면 null)
function energyFor(u, keys) {
  if (!u) return null;
  const vals = [];
  for (const k of keys) {
    const m = u[k];
    if (m && m.available !== false && m.rem != null) vals.push(m.rem);
  }
  return vals.length ? Math.min.apply(null, vals) : null;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// 얼굴 (눈+입) — solid 위에 dark, TV 화면 위엔 glow
function drawFace(ctx, cx, cy, e, frame, color, hi) {
  const eyeY = cy - 4, dx = 9;
  ctx.fillStyle = color; ctx.strokeStyle = color;
  if (e < 0.2) {                                   // 지친 눈 (\ /)
    ctx.lineWidth = 2.5; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(cx - dx - 4, eyeY - 1); ctx.lineTo(cx - dx + 3, eyeY + 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx + dx - 3, eyeY + 2); ctx.lineTo(cx + dx + 4, eyeY - 1); ctx.stroke();
  } else {                                         // 초롱초롱 (가끔 깜빡)
    const blink = (frame % 45) < 2 ? 0.12 : 1;
    ctx.beginPath(); ctx.ellipse(cx - dx, eyeY, 3.2, 4.2 * blink, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(cx + dx, eyeY, 3.2, 4.2 * blink, 0, 0, Math.PI * 2); ctx.fill();
    if (blink === 1 && hi) {
      ctx.fillStyle = hi;
      ctx.beginPath(); ctx.arc(cx - dx + 1, eyeY - 1.5, 1, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(cx + dx + 1, eyeY - 1.5, 1, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = color;
    }
  }
  ctx.lineWidth = 2.5; ctx.lineCap = "round"; ctx.beginPath();
  if (e > 0.5) ctx.arc(cx, cy + 6, 6, 0.15 * Math.PI, 0.85 * Math.PI);           // 활짝
  else if (e > 0.2) { ctx.moveTo(cx - 5, cy + 9); ctx.lineTo(cx + 5, cy + 9); }  // 무표정
  else ctx.arc(cx, cy + 14, 6, 1.15 * Math.PI, 1.85 * Math.PI);                  // 시무룩
  ctx.stroke();
}

function drawSleeping(ctx, cx, t, color, square) {
  const cy = 70, HW = 28, HH = 20;   // 가로로 긴 직사각형
  ctx.fillStyle = color || "#5A5A5A";
  if (square) { roundRect(ctx, cx - HW, cy - HH, HW * 2, HH * 2, 7); ctx.fill(); }
  else { ctx.beginPath(); ctx.arc(cx, cy, HW, 0, Math.PI * 2); ctx.fill(); }
  ctx.strokeStyle = "#1A1A1A"; ctx.lineWidth = 2.5; ctx.lineCap = "round";
  ctx.beginPath(); ctx.arc(cx - 9, cy - 3, 4, 0.1 * Math.PI, 0.9 * Math.PI); ctx.stroke();
  ctx.beginPath(); ctx.arc(cx + 9, cy - 3, 4, 0.1 * Math.PI, 0.9 * Math.PI); ctx.stroke();
  const zp = Math.floor(t) % 3;
  ctx.fillStyle = "#8B949E"; ctx.textAlign = "left";
  ctx.font = "bold 14px sans-serif"; ctx.fillText("z", cx + 22, cy - 14 - zp * 4);
  ctx.font = "bold 11px sans-serif"; ctx.fillText("z", cx + 31, cy - 24 - zp * 3);
  ctx.fillStyle = "#8B949E"; ctx.font = "11px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
  ctx.fillText("연동 대기", cx, 138);
}

// Claude: 가로 직사각형 얼굴 + 다리 4개. 발은 땅에 고정, 몸통이 좌우 스웨이 (가재처럼)
function drawClaudeChar(ctx, cx, energy, t, frame, label) {
  const W = 144;
  if (energy == null) { drawSleeping(ctx, cx, t, "#5A5A5A", true); return; }
  const e = energy / 100;
  const HW = 28, HH = 20;
  const coral = e > 0.5 ? "#D77757" : e > 0.2 ? "#C08466" : "#8B7268";

  const sway = Math.sin(t * (1.5 + e * 3)) * (2 + e * 9);   // 좌우 스웨이 (에너지↑ 크게)
  const bx = cx + sway;                                     // 몸통 X (좌우로만)
  const cy = 60;                                            // 위아래 고정
  const bodyBottom = cy + HH;
  const groundY = bodyBottom + 17;
  const feetX = [cx - 20, cx - 8, cx + 8, cx + 20];         // 발은 땅에 고정
  const attach = [-16, -6, 6, 16];
  const midY = bodyBottom + (groundY - bodyBottom) * 0.5;

  // 다리 4개 — 부착점은 몸(스웨이) 따라 움직이고 발은 고정 → 다리 각도만 변함
  ctx.strokeStyle = coral; ctx.lineWidth = 5; ctx.lineCap = "round"; ctx.lineJoin = "round";
  for (let i = 0; i < 4; i++) {
    const kneeOut = attach[i] < 0 ? -4 : 4;
    ctx.beginPath();
    ctx.moveTo(bx + attach[i], bodyBottom - 2);
    ctx.lineTo(bx + attach[i] + kneeOut, midY);   // 무릎 (바깥으로 굽힘)
    ctx.lineTo(feetX[i], groundY);                // 발 = 땅에 고정
    ctx.stroke();
  }

  // 가로로 긴 직사각형 얼굴
  ctx.fillStyle = coral;
  roundRect(ctx, bx - HW, cy - HH, HW * 2, HH * 2, 7); ctx.fill();
  drawFace(ctx, bx, cy, e, frame, "#2A1A14", "#fff");

  ctx.fillStyle = "#8B949E"; ctx.font = "11px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
  ctx.fillText((label || "Claude") + " " + energy + "%", cx, W - 6);
}

// Codex: 가로로 긴 TV (연보라 프레임 + 파랑 화면 + 안테나). 발 고정, 좌우 스웨이
function drawCodexChar(ctx, cx, energy, t, frame, label) {
  const W = 144;
  if (energy == null) { drawSleeping(ctx, cx, t, "#6B6690", true); return; }
  const e = energy / 100;
  const lav = e > 0.5 ? "#A78BFA" : e > 0.2 ? "#9285C0" : "#6E6690";
  const scr = e > 0.2 ? "#20306E" : "#181828";
  const glow = e > 0.5 ? "#7BB4FF" : e > 0.2 ? "#5B7FC0" : "#4A5580";
  const HW = 33, HH = 22;

  const sway = Math.sin(t * (1.3 + e * 2.5)) * (1.5 + e * 6);   // 좌우 스웨이
  const bx = cx + sway;
  const cy = 60;                                                // 위아래 고정
  const groundY = cy + HH + 10;
  const feetX = [cx - 17, cx + 17];                            // 발은 땅에 고정

  // 발 (몸 스웨이 → 다리 각도만 변함, 발끝은 땅에)
  ctx.strokeStyle = lav; ctx.lineWidth = 4; ctx.lineCap = "round";
  for (let i = 0; i < 2; i++) {
    ctx.beginPath();
    ctx.moveTo(bx + (i === 0 ? -17 : 17), cy + HH);
    ctx.lineTo(feetX[i], groundY);
    ctx.stroke();
  }

  // 안테나
  ctx.strokeStyle = lav; ctx.lineWidth = 3; ctx.lineCap = "round";
  const ang = 0.55 + e * 0.3 + Math.sin(t * 4) * 0.05 * e;
  for (const s of [-1, 1]) {
    const ex = bx + s * (6 + Math.cos(ang) * 15), ey = cy - HH - Math.sin(ang) * 15;
    ctx.beginPath(); ctx.moveTo(bx + s * 6, cy - HH + 2); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.fillStyle = lav; ctx.beginPath(); ctx.arc(ex, ey, 3, 0, Math.PI * 2); ctx.fill();
  }

  // TV 프레임 + 화면
  ctx.fillStyle = lav; roundRect(ctx, bx - HW, cy - HH, HW * 2, HH * 2, 7); ctx.fill();
  ctx.fillStyle = scr; roundRect(ctx, bx - HW + 5, cy - HH + 5, HW * 2 - 10, HH * 2 - 10, 4); ctx.fill();

  // 스캔라인 + 정전기(지칠수록)
  ctx.strokeStyle = "rgba(255,255,255,0.05)"; ctx.lineWidth = 1;
  for (let y = cy - HH + 8; y < cy + HH - 6; y += 4) {
    ctx.beginPath(); ctx.moveTo(bx - HW + 6, y); ctx.lineTo(bx + HW - 6, y); ctx.stroke();
  }
  if (e < 0.2) {
    ctx.fillStyle = "rgba(200,210,255,0.18)";
    for (let i = 0; i < 18; i++) {
      const gx = bx - HW + 7 + Math.random() * (HW * 2 - 14);
      const gy = cy - HH + 8 + Math.random() * (HH * 2 - 16);
      ctx.fillRect(gx, gy, 2, 1);
    }
  }

  // 화면 속 얼굴 (발광)
  drawFace(ctx, bx, cy, e, frame, glow, null);

  ctx.fillStyle = "#8B949E"; ctx.font = "11px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
  ctx.fillText((label || "Codex") + " " + energy + "%", cx, W - 6);
}

// 캐릭터 한 프레임 (provider로 아트 분기)
function drawCharacter(ctx, metric, u, frame) {
  const W = 144, cx = 72, t = frame * 0.1;
  ctx.clearRect(0, 0, W, W);
  ctx.fillStyle = "#0D1117"; ctx.fillRect(0, 0, W, W);
  const energy = energyFor(u, PROVIDER_KEYS[metric.provider] || []);
  if (metric.provider === "codex") drawCodexChar(ctx, cx, energy, t, frame, metric.label);
  else drawClaudeChar(ctx, cx, energy, t, frame, metric.label);
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
