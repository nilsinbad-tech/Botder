const DERIV_CONFIG = { endpoint: "wss://api.derivws.com/trading/v1/options/ws/public" };
let derivSocket = null, availableSymbols = [], selectedSymbol = null;
let candleBuffer = [], tickSubId = null, candleSubId = null, reconnectTimer = null, symbolsTimer = null;

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
function showApiDiagnostic(message) {
  const el = document.getElementById("api-diagnostic");
  if (el) el.textContent = message;
}
function connectDeriv() {
  if (derivSocket && [WebSocket.OPEN, WebSocket.CONNECTING].includes(derivSocket.readyState)) return;
  clearTimeout(reconnectTimer);
  derivSocket = new WebSocket(DERIV_CONFIG.endpoint);
  derivSocket.onopen = () => {
    setConnectionStatus(true);
    showApiDiagnostic("Conexión abierta. Solicitando instrumentos...");
    showChartMessage("Conectado con Deriv; esperando respuesta de instrumentos.");
    sendDeriv({ active_symbols: "full", req_id: 1 });
    clearTimeout(symbolsTimer);
    symbolsTimer = setTimeout(() => {
      if (!availableSymbols.length) showApiDiagnostic("La conexión abrió, pero no llegó active_symbols en 10 segundos. Estado WebSocket: " + derivSocket.readyState + ".");
    }, 10000);
  };
  derivSocket.onmessage = event => {
    let data;
    try { data = JSON.parse(event.data); }
    catch { showApiDiagnostic("Deriv envió una respuesta que no se pudo interpretar."); return; }
    if (data.error) {
      clearTimeout(symbolsTimer);
      showChartMessage("Error de Deriv: " + data.error.message);
      showApiDiagnostic("Error API (" + (data.error.code || "sin código") + "): " + data.error.message);
      return;
    }
    if (data.msg_type === "active_symbols") {
      clearTimeout(symbolsTimer);
      const received = Array.isArray(data.active_symbols) ? data.active_symbols : [];
      showApiDiagnostic("Deriv respondió: " + received.length + " símbolos. Buscando índices Volatility...");
      renderMarkets(received);
    }
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
  derivSocket.onerror = () => {
    showChartMessage("No se pudo conectar con Deriv.");
    showApiDiagnostic("Error de red en WebSocket. Comprueba la conexión o el acceso al servicio.");
  };
  derivSocket.onclose = event => {
    clearTimeout(symbolsTimer);
    setConnectionStatus(false);
    showApiDiagnostic("Conexión cerrada. Código: " + event.code + (event.reason ? " · " + event.reason : "") + ". Reintentando...");
    reconnectTimer = setTimeout(connectDeriv, 5000);
  };
}
function symbolCode(item) {
  return item.underlying_symbol || item.symbol || "";
}
function symbolName(item) {
  return item.underlying_symbol_name || item.display_name || item.name || symbolCode(item);
}
function selectedMarketName() {
  const item = availableSymbols.find(x => symbolCode(x) === selectedSymbol);
  return item ? symbolName(item) : selectedSymbol || "";
}
function renderMarkets(all) {
  availableSymbols = all.filter(x => {
    const searchable = [
      symbolName(x), x.underlying_symbol, x.underlying_symbol_type,
      x.market, x.submarket, x.subgroup, x.market_display_name,
      x.submarket_display_name, x.subgroup_display_name
    ].filter(Boolean).join(" ");
    return /volatility/i.test(searchable);
  }).slice(0, 10);
  const area = document.getElementById("markets"), count = document.getElementById("market-count");
  if (!area) return;
  if (count) count.textContent = availableSymbols.length + " / 10 instrumentos";
  area.innerHTML = "";
  if (!availableSymbols.length) {
    showApiDiagnostic("Deriv respondió (" + all.length + " símbolos), pero ninguno coincide con Volatility. Primeros símbolos: " + all.slice(0, 5).map(x => x.underlying_symbol_name || x.display_name || x.underlying_symbol || x.symbol || "sin nombre").join(", "));
    area.innerHTML = '<div class="empty-state">No se detectaron instrumentos Volatility. Revisa el diagnóstico.</div>';
    return;
  }
  showApiDiagnostic("Correcto: " + availableSymbols.length + " instrumentos Volatility cargados.");
  availableSymbols.forEach(item => {
    const symbol = symbolCode(item), name = symbolName(item);
    const card = document.createElement("button"); card.className = "market"; card.dataset.symbol = symbol;
    const title = document.createElement("strong"); title.textContent = name;
    const code = document.createElement("span"); code.textContent = symbol;
    card.append(title, code); card.addEventListener("click", () => selectMarket(name, symbol));
    area.appendChild(card);
  });
  if (!selectedSymbol) selectMarket(symbolName(availableSymbols[0]), symbolCode(availableSymbols[0]));
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
