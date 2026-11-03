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
    showChartMessage("Conectado. Solicitando instrumentos a Deriv...");
    sendDeriv({ active_symbols: "full", req_id: 1 });
  };
  derivSocket.onmessage = event => {
    let raw; try { raw = JSON.parse(event.data); } catch { return; }
    const data = raw.data && typeof raw.data === "object" ? { ...raw, ...raw.data } : raw;
    if (data.error || (Array.isArray(data.errors) && data.errors.length)) {
      const message = data.error?.message || data.errors?.[0]?.message || "Error desconocido";
      showChartMessage("Error de Deriv: " + message);
      const area = document.getElementById("markets");
      if (area) area.innerHTML = '<div class="empty-state">Error al cargar instrumentos: ' + message.replace(/[<>&"]/g, "") + '</div>';
      return;
    }
    if (data.msg_type === "active_symbols" || Array.isArray(data.active_symbols)) {
      renderMarkets(data.active_symbols || []);
      return;
    }
    if (data.msg_type === "candles" || data.msg_type === "history") {
      const rows = data.candles || data.history?.candles || [];
      candleBuffer = rows.map(c => ({ time: Number(c.epoch), open: Number(c.open), high: Number(c.high), low: Number(c.low), close: Number(c.close) })).filter(c => Number.isFinite(c.time) && Number.isFinite(c.close));
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
  derivSocket.onerror = () => showChartMessage("Falló la conexión WebSocket con Deriv.");
  derivSocket.onclose = () => { setConnectionStatus(false); reconnectTimer = setTimeout(connectDeriv, 5000); };
}
function symbolCode(item) { return item.symbol || item.underlying_symbol || item.underlying || ""; }
function symbolName(item) { return item.display_name || item.underlying_symbol_name || item.name || symbolCode(item) || "Índice"; }
function selectedMarketName() {
  const item = availableSymbols.find(x => symbolCode(x) === selectedSymbol);
  return item ? symbolName(item) : selectedSymbol || "";
}
function renderMarkets(all) {
  const isSynthetic = x => /volatility/i.test([x.display_name, x.underlying_symbol_name, x.symbol, x.name, x.market, x.submarket, x.subgroup, x.market_display_name].filter(Boolean).join(" "))
    || /^1HZ\d+V$/i.test(symbolCode(x)) || /^R_\d+$/i.test(symbolCode(x));
  availableSymbols = all.filter(isSynthetic);
  const area = document.getElementById("markets"), count = document.getElementById("market-count");
  if (!area) return;
  if (count) count.textContent = availableSymbols.length + " instrumentos";
  area.innerHTML = "";
  if (!availableSymbols.length) {
    const samples = all.slice(0, 5).map(x => symbolName(x) + " [" + symbolCode(x) + "]").join(" · ");
    area.innerHTML = '<div class="empty-state">Deriv respondió con ' + all.length + ' instrumentos, pero ninguno coincide con Volatility. Ejemplos recibidos: ' + (samples || "sin datos") + '</div>';
    showChartMessage("Respuesta de Deriv recibida: " + all.length + " instrumentos. Revisando nombres.");
    return;
  }
  availableSymbols.forEach(item => {
    const symbol = symbolCode(item);
    if (!symbol) return;
    const card = document.createElement("button"); card.className = "market"; card.dataset.symbol = symbol;
    const title = document.createElement("strong"); title.textContent = symbolName(item);
    const code = document.createElement("span"); code.textContent = symbol;
    card.append(title, code); card.addEventListener("click", () => selectMarket(symbolName(item), symbol));
    area.appendChild(card);
  });
  if (!selectedSymbol && availableSymbols.length) selectMarket(symbolName(availableSymbols[0]), symbolCode(availableSymbols[0]));
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
