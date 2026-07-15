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

// Task 3에서 진짜 게이지로 교체. 지금은 rem_7d 숫자만 그려 fetch+setImage 증명.
function renderTemp(u) {
  const cv = document.getElementById("c"), ctx = cv.getContext("2d");
  ctx.fillStyle = "#0D1117"; ctx.fillRect(0, 0, 144, 144);
  ctx.fillStyle = "#3FB950"; ctx.font = "bold 48px sans-serif";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText((u && u.rem_7d != null ? u.rem_7d : "--") + "%", 72, 72);
  return cv.toDataURL("image/png");
}

async function renderAll() {
  let u = null;
  try { u = await fetchUsage(); console.log("[CU] fetch ok", u); }
  catch (err) { console.log("[CU] fetch FAILED", String(err)); }  // R1 실패 시 여기 로그
  const img = renderTemp(u);
  contexts.forEach((c) => setImage(c, img));
}
