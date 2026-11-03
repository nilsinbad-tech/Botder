const signals = [];
const operations = [];
const history = [];
let signalCounter = 0;
let lastSignalKey = "";
let selectedMarket = null;

function selectMarket(name, symbol) {
  selectedMarket = { name, symbol };
  document.querySelectorAll(".market").forEach(card => {
    card.classList.toggle("active", card.dataset.symbol === symbol);
  });
  document.getElementById("chart-title").textContent = name;
  document.getElementById("chart-message").textContent = "Cargando velas M1...";
  if (typeof openMarket === "function") openMarket(symbol);
}

function addSignal(data) {
  if (!data || signals.some(s => s.symbol === data.symbol && s.status === "ACTIVE")) return;
  signalCounter++;
  signals.unshift({ id: "SIG-" + String(signalCounter).padStart(4, "0"), createdAt: Date.now(), status: "ACTIVE", ...data });
  renderSignals();
}

function markEntered(id) {
  const s = signals.find(x => x.id === id);
  if (!s || s.status !== "ACTIVE") return;
  s.status = "ENTERED";
  operations.unshift({ ...s, enteredAt: Date.now(), currentPrice: Number(s.entry), result: "OPEN" });
  renderSignals(); renderOperations();
}

function markIgnored(id) {
  const s = signals.find(x => x.id === id);
  if (!s || s.status !== "ACTIVE") return;
  s.status = "IGNORED";
  history.unshift({ ...s, result: "NO ENTRÉ", finishedAt: Date.now() });
  renderSignals(); renderHistory();
}

function updateOperationPrice(symbol, price) {
  operations.forEach(op => {
    if (op.symbol !== symbol || op.result !== "OPEN") return;
    op.currentPrice = Number(price);
    const tp = op.direction === "COMPRAR" ? price >= op.tp : price <= op.tp;
    const sl = op.direction === "COMPRAR" ? price <= op.sl : price >= op.sl;
    if (tp || sl) {
      op.result = tp ? "GANADA" : "PERDIDA";
      op.finishedAt = Date.now();
      history.unshift({ ...op });
    }
  });
  renderOperations(); renderHistory();
}

function renderSignals() {
  const area = document.getElementById("signals");
  const active = signals.filter(s => s.status === "ACTIVE");
  document.getElementById("signal-count").textContent = active.length;
  if (!active.length) { area.innerHTML = '<div class="empty-state">No hay señales activas.</div>'; return; }
  area.innerHTML = active.map(s => `
    <article class="signal-card">
      <div class="muted">${s.id} · ${s.market}</div>
      <h3 class="${s.direction === "COMPRAR" ? "buy" : "sell"}">${s.direction}</h3>
      <div class="levels">
        <div class="level"><span>ENTRADA</span><strong>${s.entry}</strong></div>
        <div class="level"><span>STOP LOSS</span><strong>${s.sl}</strong></div>
        <div class="level"><span>TAKE PROFIT</span><strong>${s.tp}</strong></div>
      </div>
      <div class="muted">Confirmación M1 · Calidad: ${s.quality}/100</div>
      <div class="action-row">
        <button class="enter-button" onclick="markEntered('${s.id}')">ENTRÉ</button>
        <button class="ignore-button" onclick="markIgnored('${s.id}')">NO ENTRÉ</button>
      </div>
    </article>`).join("");
}

function renderOperations() {
  const area = document.getElementById("operations");
  const open = operations.filter(x => x.result === "OPEN");
  document.getElementById("operation-count").textContent = open.length;
  if (!open.length) { area.innerHTML = '<div class="empty-state">No tienes operaciones en seguimiento.</div>'; return; }
  area.innerHTML = open.map(op => `
    <article class="operation-card">
      <div class="muted">${op.market}</div><h3 class="${op.direction === "COMPRAR" ? "buy" : "sell"}">${op.direction}</h3>
      <p>Entrada: ${op.entry} · Actual: <strong>${op.currentPrice}</strong></p>
      <p>SL: ${op.sl} · TP: ${op.tp}</p><span class="result-warning">EN SEGUIMIENTO</span>
    </article>`).join("");
}

function renderHistory() {
  const area = document.getElementById("history");
  if (!history.length) { area.innerHTML = '<div class="empty-state">Sin resultados registrados.</div>'; return; }
  area.innerHTML = history.map(x => `
    <article class="history-card"><strong>${x.market}</strong><p>${x.direction || ""} · ${x.result}</p>
    <span class="${x.result === "GANADA" ? "result-win" : x.result === "PERDIDA" ? "result-loss" : "result-warning"}">${x.result}</span></article>`).join("");
}

function ema(values, period) {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let value = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) value = values[i] * k + value * (1 - k);
  return value;
}

function rsi(values, period = 14) {
  if (values.length <= period) return 50;
  let gains = 0, losses = 0;
  for (let i = values.length - period; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    if (d > 0) gains += d; else losses -= d;
  }
  if (!losses) return 100;
  return 100 - 100 / (1 + gains / losses);
}

function analyzeCandles(symbol, market, candles) {
  if (!candles || candles.length < 55) return;
  const c = candles.slice(-55), closes = c.map(x => Number(x.close));
  const a = c[c.length - 1], b = c[c.length - 2];
  const e9 = ema(closes, 9), e20 = ema(closes, 20), e50 = ema(closes, 50);
  const momentum = rsi(closes), range = Math.max(a.high - a.low, Math.abs(a.close) * 0.00001);
  const buy = e9 > e20 && e20 > e50 && a.close > a.open && b.close < b.open && a.close > b.high && momentum >= 50 && momentum <= 70;
  const sell = e9 < e20 && e20 < e50 && a.close < a.open && b.close > b.open && a.close < b.low && momentum >= 30 && momentum <= 50;
  const direction = buy ? "COMPRAR" : sell ? "VENDER" : null;
  if (!direction) return;
  const key = symbol + ":" + a.time + ":" + direction;
  if (key === lastSignalKey) return;
  lastSignalKey = key;
  const entry = Number(a.close), sl = buy ? Math.min(...c.slice(-7).map(x => x.low)) : Math.max(...c.slice(-7).map(x => x.high));
  const risk = Math.max(Math.abs(entry - sl), range * 0.5), tp = buy ? entry + risk * 1.5 : entry - risk * 1.5;
  addSignal({ symbol, market, direction, entry, sl, tp, quality: 75, candleTime: a.time });
}

document.addEventListener("DOMContentLoaded", () => {
  if (typeof createMarketChart === "function") createMarketChart();
});
