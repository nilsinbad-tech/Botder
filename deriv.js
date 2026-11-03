const DERIV_CONFIG = { endpoint: "wss://api.derivws.com/trading/v1/options/ws/public" };
let derivSocket = null, availableSymbols = [], selectedSymbol = null;
let candleBuffer = [], tickSubId = null, candleSubId = null, reconnectTimer = null, symbolsTimer = null, selectedGranularity = 60;

function responseSymbol(data) { const q=data && data.echo_req || {}; return q.ticks_history || q.ticks || q.symbol || null; }
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
    if (data.msg_type === "history" && responseSymbol(data) === selectedSymbol && data.history && Array.isArray(data.history.times)) {
      const historicalTicks = aggregateTicks(data.history.times, data.history.prices, selectedGranularity);
      if (data.req_id === 12) {
        candleBuffer = historicalTicks;
        if (typeof setBacktestHistory === "function") setBacktestHistory(selectedSymbol, selectedMarketName(), historicalTicks);
      } else {
        candleBuffer = historicalTicks;
      }
      if (typeof updateCandles === "function") updateCandles(candleBuffer);
      if (typeof analyzeCandles === "function") analyzeCandles(selectedSymbol, selectedMarketName(), candleBuffer);
      showChartMessage("Historial · " + (selectedGranularity === 30 ? "30 segundos" : (selectedGranularity/60) + " min") + " · " + candleBuffer.length + " velas");
    }
    if (data.msg_type === "candles" && responseSymbol(data) === selectedSymbol && data.req_id === 12) {
      const historical = (data.candles || []).map(c => ({ time: Number(c.epoch), open: Number(c.open), high: Number(c.high), low: Number(c.low), close: Number(c.close) }));
      if (typeof setBacktestHistory === "function") setBacktestHistory(selectedSymbol, selectedMarketName(), historical);
    }
    if (data.msg_type === "candles" && responseSymbol(data) === selectedSymbol && data.req_id !== 12) {
      candleBuffer = (data.candles || []).map(c => ({ time: Number(c.epoch), open: Number(c.open), high: Number(c.high), low: Number(c.low), close: Number(c.close) }));
      if (typeof updateCandles === "function") updateCandles(candleBuffer);
      if (typeof analyzeCandles === "function") analyzeCandles(selectedSymbol, selectedMarketName(), candleBuffer);
      showChartMessage("Historial cargado · " + candleBuffer.length + " velas · " + (selectedGranularity/60) + " min");
    }
    if (data.msg_type === "ohlc" && responseSymbol(data) === selectedSymbol && data.ohlc) {
      const o = data.ohlc, candle = { time: Number(o.open_time), open: Number(o.open), high: Number(o.high), low: Number(o.low), close: Number(o.close) };
      if (candleBuffer.length && candleBuffer[candleBuffer.length - 1].time === candle.time) candleBuffer[candleBuffer.length - 1] = candle;
      else candleBuffer.push(candle);
      if (typeof addCandle === "function") addCandle(candle);
      const priceEl = document.getElementById("current-price"); if (priceEl) priceEl.textContent = candle.close.toFixed(4);
      if (typeof analyzeCandles === "function") analyzeCandles(selectedSymbol, selectedMarketName(), candleBuffer);
    }
    if (data.msg_type === "tick" && responseSymbol(data) === selectedSymbol && data.tick) {
      const price = Number(data.tick.quote);
      const el = document.getElementById("current-price"); if (el && Number.isFinite(price)) el.textContent = price.toFixed(4);
      if (Number.isFinite(price) && selectedSymbol) {
        updateOperationPrice(selectedSymbol, price);
        const interval = selectedGranularity, bucket = Math.floor(Number(data.tick.epoch) / interval) * interval;
        let live = candleBuffer[candleBuffer.length - 1];
        if (!live || live.time !== bucket) { live = { time: bucket, open: price, high: price, low: price, close: price }; candleBuffer.push(live); }
        else { live = { ...live, high: Math.max(live.high, price), low: Math.min(live.low, price), close: price }; candleBuffer[candleBuffer.length - 1] = live; }
        if (typeof addCandle === "function") addCandle(live);
        if (typeof analyzeCandles === "function") analyzeCandles(selectedSymbol, selectedMarketName(), candleBuffer);
        if (typeof updateBacktestTick === "function") updateBacktestTick(Number(data.tick.epoch), price);
      }
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
 availableSymbols=all.filter(x=>{
  const searchable=[symbolName(x),x.underlying_symbol,x.underlying_symbol_type,x.market,x.submarket,x.subgroup,x.market_display_name,x.submarket_display_name,x.subgroup_display_name].filter(Boolean).join(" ");
  return /volatility/i.test(searchable);
 }).sort((a,b)=>symbolName(a).localeCompare(symbolName(b)));
 const area=document.getElementById("markets"),count=document.getElementById("market-count");if(!area)return;
 if(count)count.textContent=availableSymbols.length+" instrumentos";area.innerHTML="";
 if(!availableSymbols.length){showApiDiagnostic("Deriv respondió ("+all.length+" símbolos), pero no se detectó ningún índice Volatility.");area.innerHTML='<div class="empty-state">No se detectaron instrumentos Volatility.</div>';return;}
 const groups=new Map();
 availableSymbols.forEach(item=>{const label=/1s|1 second|1-second/i.test(symbolName(item)+" "+symbolCode(item))?"VOLATILITY 1 SEGUNDO":"VOLATILITY ESTÁNDAR";if(!groups.has(label))groups.set(label,[]);groups.get(label).push(item);});
 groups.forEach((items,label)=>{
  const section=document.createElement("section");section.className="instrument-group";
  const heading=document.createElement("h3");heading.textContent=label+" · "+items.length;section.appendChild(heading);
  const list=document.createElement("div");list.className="instrument-list";
  items.forEach(item=>{const symbol=symbolCode(item),name=symbolName(item),card=document.createElement("button");card.className="market";card.dataset.symbol=symbol;const title=document.createElement("strong"),code=document.createElement("span");title.textContent=name;code.textContent=symbol;card.append(title,code);card.addEventListener("click",()=>selectMarket(name,symbol));list.appendChild(card);});
  section.appendChild(list);area.appendChild(section);
 });
 showApiDiagnostic("Correcto: "+availableSymbols.length+" índices Volatility organizados por categoría.");
 if(!selectedSymbol)selectMarket(symbolName(availableSymbols[0]),symbolCode(availableSymbols[0]));
}
function aggregateTicks(times, prices, seconds) {
  const candles = new Map();
  (times || []).forEach((time, i) => {
    const t = Number(time), p = Number(prices[i]);
    if (!Number.isFinite(t) || !Number.isFinite(p)) return;
    const bucket = Math.floor(t / seconds) * seconds;
    const c = candles.get(bucket);
    if (!c) candles.set(bucket, { time: bucket, open: p, high: p, low: p, close: p });
    else { c.high = Math.max(c.high, p); c.low = Math.min(c.low, p); c.close = p; }
  });
  return [...candles.values()].sort((a,b) => a.time-b.time);
}
function loadMarketHistory(symbol, granularity = selectedGranularity) {
  selectedGranularity = granularity;
  if (typeof setChartGranularity === "function") setChartGranularity(granularity);
  if (!symbol || !derivSocket || derivSocket.readyState !== WebSocket.OPEN) return;
  candleBuffer = [];
  if (typeof setChartSymbol === "function") setChartSymbol(symbol);
  const tf = document.getElementById("timeframe"); if (tf) tf.value = String(granularity);
  if (typeof setChartGranularity === "function") setChartGranularity(selectedGranularity);
  if (typeof setAnalysisGranularity === "function") setAnalysisGranularity(selectedGranularity);
  if (selectedGranularity === 30) {
    sendDeriv({ ticks_history: symbol, count: 1000, end: "latest", style: "ticks", req_id: 12 });
    showChartMessage("Construyendo velas de 30 segundos desde ticks de Deriv...");
  } else {
    sendDeriv({ ticks_history: symbol, count: 5000, end: "latest", style: "candles", granularity: selectedGranularity, req_id: 12 });
    sendDeriv({ ticks_history: symbol, start: 0, end: "latest", style: "candles", granularity: selectedGranularity, subscribe: 1, req_id: 10 });
    showChartMessage("Cargando historial · " + (selectedGranularity/60) + " min...");
  }
}
function openMarket(symbol) {
  if (!symbol || !sendDeriv({ forget_all: "ticks" })) { /* socket may still be connecting */ }
  if (!derivSocket || derivSocket.readyState !== WebSocket.OPEN) return;
  selectedSymbol = symbol; candleBuffer = []; tickSubId = null; candleSubId = null;
  sendDeriv({ forget_all: "candles" });
  sendDeriv({ forget_all: "ticks" });
  if (typeof setChartSymbol === "function") setChartSymbol(symbol);
  const price = document.getElementById("current-price"); if (price) price.textContent = "---";
  loadMarketHistory(symbol, selectedGranularity);
  sendDeriv({ ticks: symbol, subscribe: 1, req_id: 11 });
  showChartMessage("Solicitando gráfico y precio en vivo...");
}
function getAvailableSymbols() { return availableSymbols; }
function isDerivConnected() { return derivSocket && derivSocket.readyState === WebSocket.OPEN; }
document.addEventListener("DOMContentLoaded", () => {
  const tf = document.getElementById("timeframe");
  if (tf) { tf.value = "60"; tf.disabled = false; tf.addEventListener("change", () => { const n=60;tf.value="60";selectedGranularity=60;if(selectedSymbol)loadMarketHistory(selectedSymbol,60); }); }
  const style=document.getElementById("candle-style");if(style)style.addEventListener("change",()=>{if(typeof setCandleStyle==="function")setCandleStyle(style.value);});
});
connectDeriv();
