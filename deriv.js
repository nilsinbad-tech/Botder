const DERIV_CONFIG = { endpoint: "wss://api.derivws.com/trading/v1/options/ws/public" };
let derivSocket = null, availableSymbols = [], selectedSymbol = null;
let candleBuffer = [], tickSubId = null, candleSubId = null, reconnectTimer = null;

function sendDeriv(data) {
  if (!derivSocket || derivSocket.readyState !== WebSocket.OPEN) return false;
  derivSocket.send(JSON.stringify(data)); return true;
}
function setConnectionStatus(ok) {
  const el = document.getElementById("connection"); if (!el) return;
  el.textContent = ok ? "● CONECTADO" : "● DESCONECTADO";
  el.className = ok ? "connection online" : "connection offline";
}
function showChartMessage(message) {
  const el = document.getElementById("chart-message"); if (el) el.textContent = message;
}
function connectDeriv() {
  if (derivSocket && [WebSocket.OPEN, WebSocket.CONNECTING].includes(derivSocket.readyState)) return;
  clearTimeout(reconnectTimer);
  derivSocket = new WebSocket(DERIV_CONFIG.endpoint);
  derivSocket.onopen = () => {
    setConnectionStatus(true);
    sendDeriv({ active_symbols: "brief", product_type: "basic", req_id: 1 });
  };
  derivSocket.onmessage = event => {
    let data; try { data = JSON.parse(event.data); } catch { return; }
    if (data.error) { showChartMessage("Deriv: " + data.error.message); return; }
    if (data.msg_type === "active_symbols") renderMarkets(data.active_symbols || []);
    if (data.msg_type === "candles" || data.msg_type === "history") {
      candleBuffer = (data.candles || []).map(c => ({ time: Number(c.epoch), open: Number(c.open), high: Number(c.high), low: Number(c.low), close: Number(c.close) }));
      if (typeof updateCandles === "function") updateCandles(candleBuffer);
      if (typeof analyzeCandles === "function") analyzeCandles(selectedSymbol, selectedMarketName(), candleBuffer);
      showChartMessage("Gráfico M1 en vivo · " + candleBuffer.length + " velas cargadas");
    }
    if (data.msg_type === "ohlc" && data.ohlc) {
      const o = data.ohlc, candle = { time: Number(o.open_time), open: Number(o.open), high: Number(o.high), low: Number(o.low), close: Number(o.close) };
      if (candleBuffer.length && candleBuffer[candleBuffer.length - 1].time === candle.time) candleBuffer[candleBuffer.length - 1] = candle;
      else candleBuffer.push(candle);
      if (typeof addCandle === "function") addCandle(candle);
      if (typeof analyzeCandles === "function") analyzeCandles(selectedSymbol, selectedMarketName(), candleBuffer);
    }
    if (data.msg_type === "tick" && data.tick) {
      const price = Number(data.tick.quote);
      const el = document.getElementById("current-price"); if (el) el.textContent = price.toFixed(4);
      if (selectedSymbol) updateOperationPrice(selectedSymbol, price);
    }
  };
  derivSocket.onerror = () => showChartMessage("No se pudo conectar con Deriv.");
  derivSocket.onclose = () => { setConnectionStatus(false); reconnectTimer = setTimeout(connectDeriv, 5000); };
}
function selectedMarketName() {
  const item = availableSymbols.find(x => x.symbol === selectedSymbol);
  return item ? item.display_name : selectedSymbol || "";
}
function renderMarkets(all) {
  availableSymbols = all.filter(x => /volatility/i.test((x.display_name || "") + " " + (x.submarket || ""))).slice(0, 10);
  const area = document.getElementById("markets"), count = document.getElementById("market-count");
  if (!area) return;
  if (count) count.textContent = availableSymbols.length + " / 10 instrumentos";
  area.innerHTML = "";
  if (!availableSymbols.length) { area.innerHTML = '<div class="empty-state">Deriv conectó, pero no devolvió índices Volatility. Revisa la respuesta de símbolos.</div>'; return; }
  availableSymbols.forEach(item => {
    const card = document.createElement("button"); card.className = "market"; card.dataset.symbol = item.symbol;
    const title = document.createElement("strong"); title.textContent = item.display_name || item.symbol;
    const code = document.createElement("span"); code.textContent = item.symbol;
    card.append(title, code); card.addEventListener("click", () => selectMarket(item.display_name || item.symbol, item.symbol));
    area.appendChild(card);
  });
  if (!selectedSymbol) selectMarket(availableSymbols[0].display_name || availableSymbols[0].symbol, availableSymbols[0].symbol);
}
function openMarket(symbol) {
  if (!symbol || !sendDeriv({ forget_all: "ticks" })) { /* socket may still be connecting */ }
  if (!derivSocket || derivSocket.readyState !== WebSocket.OPEN) return;
  selectedSymbol = symbol; candleBuffer = []; tickSubId = null; candleSubId = null;
  if (typeof setChartSymbol === "function") setChartSymbol(symbol);
  const price = document.getElementById("current-price"); if (price) price.textContent = "---";
  sendDeriv({ ticks_history: symbol, count: 120, end: "latest", style: "candles", granularity: 60, subscribe: 1, req_id: 10 });
  sendDeriv({ ticks: symbol, subscribe: 1, req_id: 11 });
  showChartMessage("Solicitando velas M1 y precio en vivo...");
}
function getAvailableSymbols() { return availableSymbols; }
function isDerivConnected() { return derivSocket && derivSocket.readyState === WebSocket.OPEN; }
connectDeriv();
