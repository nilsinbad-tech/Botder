const DERIV_CONFIG = { endpoint: "wss://api.derivws.com/trading/v1/options/ws/public" };
const MAX_INSTRUMENTS = 10;
let derivSocket = null, availableSymbols = [], selectedSymbol = null;
let candleBuffer = [], scannerCandles = new Map(), reconnectTimer = null;

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
    showChartMessage("Conectado. Buscando los 10 instrumentos...");
    sendDeriv({ active_symbols: "brief", product_type: "basic", req_id: 1 });
  };
  derivSocket.onmessage = event => {
    let data; try { data = JSON.parse(event.data); } catch { return; }
    if (data.error) { showChartMessage("Deriv: " + data.error.message); return; }
    if (data.msg_type === "active_symbols") { renderMarkets(data.active_symbols || []); return; }
    if (data.msg_type === "history" || data.msg_type === "candles") {
      const symbol = data.echo_req && data.echo_req.ticks_history;
      if (!symbol) return;
      const candles = (data.candles || []).map(c => ({ time:Number(c.epoch), open:Number(c.open), high:Number(c.high), low:Number(c.low), close:Number(c.close) }));
      scannerCandles.set(symbol, candles);
      if (symbol === selectedSymbol) {
        candleBuffer = candles.slice();
        if (typeof updateCandles === "function") updateCandles(candleBuffer);
        showChartMessage("Gráfico M1 en vivo · " + candleBuffer.length + " velas");
      }
      if (typeof analyzeCandles === "function") analyzeCandles(symbol, marketName(symbol), candles);
      return;
    }
    if (data.msg_type === "ohlc" && data.ohlc) {
      const o=data.ohlc, symbol=o.symbol;
      if (!symbol) return;
      const candle={time:Number(o.open_time),open:Number(o.open),high:Number(o.high),low:Number(o.low),close:Number(o.close)};
      const list=scannerCandles.get(symbol) || [];
      if (list.length && list[list.length-1].time===candle.time) list[list.length-1]=candle;
      else list.push(candle);
      if (list.length>150) list.shift();
      scannerCandles.set(symbol,list);
      if (symbol===selectedSymbol) {
        candleBuffer=list;
        if (typeof addCandle==="function") addCandle(candle);
      }
      if (typeof analyzeCandles==="function") analyzeCandles(symbol,marketName(symbol),list);
      return;
    }
    if (data.msg_type === "tick" && data.tick) {
      const symbol=data.tick.symbol, price=Number(data.tick.quote);
      if (symbol===selectedSymbol) {
        const el=document.getElementById("current-price"); if(el) el.textContent=price.toFixed(4);
      }
      if (symbol && typeof updateOperationPrice==="function") updateOperationPrice(symbol,price);
    }
  };
  derivSocket.onerror = () => showChartMessage("No se pudo conectar con Deriv.");
  derivSocket.onclose = () => { setConnectionStatus(false); reconnectTimer=setTimeout(connectDeriv,5000); };
}
function marketName(symbol) {
  const item=availableSymbols.find(x=>x.symbol===symbol);
  return item ? (item.display_name || item.symbol) : symbol;
}
function renderMarkets(all) {
  const volatility=all.filter(x=>/volatility/i.test((x.display_name||"")+" "+(x.submarket||"")));
  availableSymbols=volatility.slice().sort((a,b)=>String(a.symbol).localeCompare(String(b.symbol))).slice(0,MAX_INSTRUMENTS);
  const area=document.getElementById("markets"), count=document.getElementById("market-count");
  if(!area) return;
  if(count) count.textContent=availableSymbols.length+" / 10 instrumentos";
  area.innerHTML="";
  if(!availableSymbols.length) {
    area.innerHTML='<div class="empty-state">Deriv no devolvió instrumentos Volatility.</div>';
    return;
  }
  availableSymbols.forEach(item=>{
    const card=document.createElement("button"); card.className="market"; card.dataset.symbol=item.symbol;
    const title=document.createElement("strong"); title.textContent=item.display_name||item.symbol;
    const code=document.createElement("span"); code.textContent=item.symbol;
    card.append(title,code);
    card.addEventListener("click",()=>selectMarket(item.display_name||item.symbol,item.symbol));
    area.appendChild(card);
  });
  startScanner();
  if(!selectedSymbol) selectMarket(availableSymbols[0].display_name||availableSymbols[0].symbol,availableSymbols[0].symbol);
}
function startScanner() {
  scannerCandles.clear();
  availableSymbols.forEach((item,index)=>{
    scannerCandles.set(item.symbol,[]);
    sendDeriv({ticks_history:item.symbol,count:120,end:"latest",style:"candles",granularity:60,subscribe:1,req_id:100+index});
    sendDeriv({ticks:item.symbol,subscribe:1,req_id:200+index});
    sendDeriv({ohlc:item.symbol, granularity:60, subscribe:1, req_id:300+index});
  });
  showChartMessage("Escaneando "+availableSymbols.length+" instrumentos en M1...");
}
function openMarket(symbol) {
  if (!symbol || !derivSocket || derivSocket.readyState!==WebSocket.OPEN) return;
  selectedSymbol=symbol;
  const list=scannerCandles.get(symbol)||[];
  candleBuffer=list.slice();
  if(typeof setChartSymbol==="function") setChartSymbol(symbol);
  if(typeof updateCandles==="function" && candleBuffer.length) updateCandles(candleBuffer);
  const price=document.getElementById("current-price"); if(price) price.textContent="---";
  showChartMessage("Seleccionado: "+marketName(symbol)+" · escáner M1 activo");
}
function getAvailableSymbols(){return availableSymbols;}
function isDerivConnected(){return derivSocket&&derivSocket.readyState===WebSocket.OPEN;}
connectDeriv();
