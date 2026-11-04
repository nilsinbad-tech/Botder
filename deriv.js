const DERIV_CONFIG = { endpoint: "wss://api.derivws.com/trading/v1/options/ws/public" };
let derivSocket = null, availableSymbols = [], selectedSymbol = null;
let candleBuffer = [], higherTfBuffers={1800:[],3600:[],14400:[],86400:[]}, tickSubId = null, candleSubId = null, reconnectTimer = null, symbolsTimer = null, selectedGranularity = 60, lastTickAt = 0, lastTickResubscribeAt = 0;

function getHigherTimeframeHistory(seconds){const raw=higherTfBuffers[Number(seconds)]||[];if(!raw.length||!candleBuffer.length)return raw;const live=aggregateForDisplay(candleBuffer,Number(seconds)).at(-1);if(!live)return raw;const merged=raw.filter(c=>c.time!==live.time);merged.push(live);return merged.sort((a,b)=>a.time-b.time);}
function getDisplayCandles(seconds){const base=aggregateForDisplay(candleBuffer,seconds);if(seconds<3600)return base;const history=getHigherTimeframeHistory(seconds);if(!history.length)return base;const live=base.at(-1);if(!live)return history.slice();const out=history.filter(c=>c.time!==live.time);out.push(live);return out.sort((a,b)=>a.time-b.time);}
function responseSymbol(data) { const q=data && data.echo_req || {}; const value=q.ticks_history||q.ticks||q.symbol||data?.tick?.symbol||data?.ohlc?.symbol||null; return Array.isArray(value)?value[0]:value; }
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
    if([13,14,15,16].includes(data.req_id)&&selectedSymbol&&responseSymbol(data)===selectedSymbol&&(data.msg_type==="history"||data.msg_type==="candles")){const seconds=({13:3600,14:14400,15:86400,16:1800})[data.req_id],rows=data.candles||data.history?.candles||[],parsed=rows.map(c=>({time:Number(c.epoch??c.open_time),open:Number(c.open),high:Number(c.high),low:Number(c.low),close:Number(c.close)})).filter(c=>[c.time,c.open,c.high,c.low,c.close].every(Number.isFinite));if(parsed.length){higherTfBuffers[seconds]=parsed.sort((a,b)=>a.time-b.time);if(selectedGranularity===seconds&&typeof updateCandles==="function")updateCandles(getDisplayCandles(seconds));if(typeof analyzeCandles==="function"&&candleBuffer.length>=100)analyzeCandles(selectedSymbol,selectedMarketName(),candleBuffer);showApiDiagnostic("Historial HTF cargado · "+(seconds===1800?"M30":seconds===3600?"H1":seconds===14400?"H4":"D1")+" · "+parsed.length+" velas.");}}
    if (data.req_id === 12 && selectedSymbol && responseSymbol(data)===selectedSymbol && (data.msg_type === "history" || data.msg_type === "candles")) {
      const history = data.history || {};
      let historical = [];
      const rows = Array.isArray(data.candles) ? data.candles : (Array.isArray(history.candles) ? history.candles : null);
      if (rows) {
        historical = rows.map(c => ({time:Number(c.epoch ?? c.open_time),open:Number(c.open),high:Number(c.high),low:Number(c.low),close:Number(c.close)})).filter(c => [c.time,c.open,c.high,c.low,c.close].every(Number.isFinite));
      } else if (Array.isArray(history.times) && Array.isArray(history.prices)) {
        historical = aggregateTicks(history.times, history.prices, 60);
      }
      if (historical.length) {
        // Conserva los ticks que hayan llegado mientras se descargaba el historial.
        const liveByTime=new Map(candleBuffer.map(c=>[c.time,c]));
        historical=historical.map(c=>{const live=liveByTime.get(c.time);return live?{...c,high:Math.max(c.high,live.high),low:Math.min(c.low,live.low),close:live.close}:c;});
        const lastHistoryTime=historical.at(-1)?.time??-Infinity;
        const newerLive=[...liveByTime.values()].filter(c=>c.time>lastHistoryTime).sort((a,b)=>a.time-b.time);
        candleBuffer=[...historical,...newerLive];
        if (typeof setBacktestHistory === "function") setBacktestHistory(selectedSymbol, selectedMarketName(), historical);
        if (typeof updateCandles === "function") updateCandles(getDisplayCandles(selectedGranularity));
        if (typeof analyzeCandles === "function") analyzeCandles(selectedSymbol, selectedMarketName(), candleBuffer);
        showChartMessage("Historial base M1 · "+historical.length+" velas · vista "+(selectedGranularity===3600?"H1":selectedGranularity===14400?"H4":"M"+(selectedGranularity/60))+".");
        showApiDiagnostic("Deriv entregó " + historical.length + " velas para " + selectedSymbol + ".");
      } else {
        showChartMessage("Deriv respondió, pero no entregó velas en el historial. Esperando ticks para construirlas...");
        showApiDiagnostic("Respuesta de historial recibida sin datos de velas. Tipo: " + data.msg_type + ".");
      }
    }
    if (data.msg_type === "candles" && responseSymbol(data) === selectedSymbol && ![12,13,14,15,16].includes(data.req_id)) {
      candleBuffer = (data.candles || []).map(c => ({ time: Number(c.epoch), open: Number(c.open), high: Number(c.high), low: Number(c.low), close: Number(c.close) }));
      if (typeof updateCandles === "function") updateCandles(candleBuffer);
      if (typeof analyzeCandles === "function") analyzeCandles(selectedSymbol, selectedMarketName(), candleBuffer);
      showChartMessage("Historial cargado · " + candleBuffer.length + " velas · " + (selectedGranularity/60) + " min");
    }
    if (data.msg_type === "ohlc" && responseSymbol(data) === selectedSymbol && data.ohlc) {
      const o = data.ohlc, candle = { time: Number(o.open_time), open: Number(o.open), high: Number(o.high), low: Number(o.low), close: Number(o.close) };
      if (candleBuffer.length && candleBuffer[candleBuffer.length - 1].time === candle.time) candleBuffer[candleBuffer.length - 1] = candle;
      else candleBuffer.push(candle);
      if(selectedGranularity===60){if(typeof addCandle==="function")addCandle(candle);}else if(typeof updateCandles==="function")updateCandles(getDisplayCandles(selectedGranularity));
      // El precio visible lo controla exclusivamente el flujo tick; no permitir que una vela histórica lo retrase.
      if (typeof analyzeCandles === "function") analyzeCandles(selectedSymbol, selectedMarketName(), candleBuffer);
    }
    if (data.msg_type === "tick" && data.tick) {
      const price = Number(data.tick.quote), epoch = Number(data.tick.epoch), tickSymbol = data.tick.symbol || responseSymbol(data);
      if (!selectedSymbol || (tickSymbol && tickSymbol !== selectedSymbol)) return;
      const el = document.getElementById("current-price");
      if (Number.isFinite(price)) {
        const decimals = Number.isInteger(Number(data.tick.pip_size)) ? Number(data.tick.pip_size) : (String(data.tick.quote).split(".")[1] || "").length;
        if (el) { el.textContent = price.toFixed(Math.max(0,Math.min(8,decimals))); el.dataset.updatedAt = String(epoch); el.dataset.receivedAt = String(Date.now()); }
        lastTickAt = Date.now(); tickSubId = data.subscription?.id || tickSubId;
        if (typeof setLiveChartPrice === "function") setLiveChartPrice(price);
      }
      if (Number.isFinite(price) && Number.isFinite(epoch) && selectedSymbol) {
        updateOperationPrice(selectedSymbol, price);
        const interval = 60, bucket = Math.floor(epoch / interval) * interval;
        let live = candleBuffer[candleBuffer.length - 1], candleClosed = false;
        if (!live || live.time !== bucket) {
          live = { time: bucket, open: price, high: price, low: price, close: price };
          candleBuffer.push(live);
          candleClosed = true;
        } else {
          live = { ...live, high: Math.max(live.high, price), low: Math.min(live.low, price), close: price };
          candleBuffer[candleBuffer.length - 1] = live;
        }
        // Actualiza la vela visible con cada tick; el dibujo se agrupa en requestAnimationFrame.
        if(selectedGranularity===60){if(typeof addCandle==="function")addCandle(live);}else if(typeof updateCandles==="function")updateCandles(getDisplayCandles(selectedGranularity));
        // Previsualiza OB en cada tick mientras la vela M1 se está formando; no espera al cierre.
        if (typeof analyzeLiveStructure === "function") analyzeLiveStructure(selectedSymbol, candleBuffer);
        // Recalcula la estructura/backtest solo cuando comienza una vela nueva (la anterior cerró).
        if (candleClosed) {
          if (typeof analyzeCandles === "function" && candleBuffer.length >= 100)
            analyzeCandles(selectedSymbol, selectedMarketName(), candleBuffer);
          if (typeof updateBacktestTick === "function") updateBacktestTick(epoch, price);
        }
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
function aggregateForDisplay(candles,seconds){if(seconds<=60)return candles.slice();const m=new Map();for(const c of candles){const t=Math.floor(c.time/seconds)*seconds;let v=m.get(t);if(!v)m.set(t,{time:t,open:c.open,high:c.high,low:c.low,close:c.close});else{v.high=Math.max(v.high,c.high);v.low=Math.min(v.low,c.low);v.close=c.close;}}return [...m.values()].sort((a,b)=>a.time-b.time);}
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
    sendDeriv({ ticks_history: symbol, count: 5000, end: "latest", style: "ticks", req_id: 12 });
    showChartMessage("Construyendo velas de 30 segundos desde ticks de Deriv...");
  } else {
    sendDeriv({ticks_history:symbol,count:5000,end:"latest",style:"candles",granularity:60,req_id:12});sendDeriv({ticks_history:symbol,count:5000,end:"latest",style:"candles",granularity:1800,req_id:16});sendDeriv({ticks_history:symbol,count:5000,end:"latest",style:"candles",granularity:3600,req_id:13});sendDeriv({ticks_history:symbol,count:5000,end:"latest",style:"candles",granularity:14400,req_id:14});sendDeriv({ticks_history:symbol,count:1000,end:"latest",style:"candles",granularity:86400,req_id:15});
    // El historial M1 de 5000 velas se carga en una sola respuesta; los ticks actualizan la vela viva sin reemplazarlo por un bloque corto.
    showChartMessage("Cargando historial · " + (selectedGranularity/60) + " min...");
  }
}
function openMarket(symbol) {
  if (!symbol || !sendDeriv({ forget_all: "ticks" })) { /* socket may still be connecting */ }
  if (!derivSocket || derivSocket.readyState !== WebSocket.OPEN) return;
  selectedSymbol = symbol; candleBuffer = []; higherTfBuffers={1800:[],3600:[],14400:[],86400:[]}; tickSubId = null; candleSubId = null; lastTickAt = 0; lastTickResubscribeAt = 0;
  sendDeriv({ forget_all: "candles" });
  sendDeriv({ forget_all: "ticks" });
  if (typeof setChartSymbol === "function") setChartSymbol(symbol);
  const price = document.getElementById("current-price"); if (price) price.textContent = "---";
  loadMarketHistory(symbol, selectedGranularity);
  sendDeriv({ ticks: symbol, subscribe: 1, req_id: 11 }); lastTickResubscribeAt = Date.now();
  showChartMessage("Solicitando gráfico y precio en vivo...");
}
function getAvailableSymbols() { return availableSymbols; }
function isDerivConnected() { return derivSocket && derivSocket.readyState === WebSocket.OPEN; }
document.addEventListener("DOMContentLoaded", () => {
  const tf = document.getElementById("timeframe");
  const tfButtons=[...document.querySelectorAll(".timeframe-button")];
  const syncTfButtons=()=>tfButtons.forEach(b=>b.classList.toggle("active",b.dataset.tf===String(tf?.value||"60")));
  if(tf){tf.value="60";tf.disabled=false;tf.addEventListener("change",()=>{selectedGranularity=Number(tf.value)||60;if(typeof setChartGranularity==="function")setChartGranularity(selectedGranularity);syncTfButtons();if(selectedSymbol&&candleBuffer.length&&typeof updateCandles==="function"){const h=getHigherTimeframeHistory(selectedGranularity);updateCandles(h.length?getDisplayCandles(selectedGranularity):aggregateForDisplay(candleBuffer,selectedGranularity));analyzeCandles(selectedSymbol,selectedMarketName(),candleBuffer);}});}
  tfButtons.forEach(b=>b.addEventListener("click",()=>{if(!tf)return;tf.value=b.dataset.tf;tf.dispatchEvent(new Event("change",{bubbles:true}));}));
  syncTfButtons();
  const style=document.getElementById("candle-style");if(style)style.addEventListener("change",()=>{if(typeof setCandleStyle==="function")setCandleStyle(style.value);});
});
connectDeriv();

// Vigila la suscripción: si dejan de llegar ticks, la renueva sin recargar la página.
setInterval(() => { if (!selectedSymbol || !derivSocket || derivSocket.readyState !== WebSocket.OPEN) return; const now=Date.now(); if (lastTickAt && now-lastTickAt<9000) return; if (now-lastTickResubscribeAt<9000) return; sendDeriv({ forget_all: "ticks" }); sendDeriv({ ticks: selectedSymbol, subscribe: 1, req_id: 11 }); lastTickResubscribeAt=now; showApiDiagnostic("Reactivando el flujo de precio en vivo…"); }, 3000);
