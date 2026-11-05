/* BOTDER · motor de análisis y backtesting. Sin ejecución de órdenes. */
(() => {
'use strict';
const HISTORY_CANDLES = 4320;
const REQUEST_TIMEOUT_MS = 45000;
const API_URL = 'wss://api.derivws.com/trading/v1/options/ws/public';
const $ = id => document.getElementById(id);
const state = { ws:null, req:0, pending:new Map(), symbols:[], selected:null, tf:1, candles:[], rawCandles:[], rawBySymbol:new Map(), marketBacktests:[], savedChartTrades:[], trades:[], liveSub:null, main:null, rsi:null, markerPlugin:null, overlayResizeObserver:null, overlayUpdate:null, overlayRangeHandler:null, pivotLines:[], tradePriceLines:[], overlayPriceLevels:[],levelOverrides:{}, pivotTfEnabled:{1:false,2:false,3:false,4:false,5:true,10:false,30:false,60:false}, tpTfs:[1,3,5,10], slTfs:[1,3,5,10], obStructureOnly:true, obTf:1, obPrimaryTf:10, obPreviousTf:30, obPreviousEnabled:false, pivotTf:5, chartKey:null, series:{}, busy:false, analyzeQueued:false, forceFitNext:true, lastRecalcBucket:null, pendingLiveTick:null, liveFrame:0, overlayFrame:0 };
const PERSIST_KEY='botder-history-v3';
function tradeKey(t){return Number.isFinite(Number(t.structureTime))?String(t.symbol||'')+'|'+String(t.side||'')+'|ZONA|'+String(t.structureTime):String(t.symbol||'')+'|'+String(t.time)+'|'+String(t.side||'');}
function mergeTrades(oldItems,newItems,limit=2000){const map=new Map();for(const t of [...(oldItems||[]),...(newItems||[])]){if(!t||!Number.isFinite(Number(t.time))||!t.side)continue;map.set(tradeKey(t),t);}return [...map.values()].sort((a,b)=>a.time-b.time).slice(-limit);}
function savePersistentState(){try{localStorage.setItem(PERSIST_KEY,JSON.stringify({version:3,selected:state.selected,marketBacktests:state.marketBacktests.slice(-2000),savedChartTrades:state.savedChartTrades.slice(-2000)}));}catch(e){console.warn('No se pudo guardar el historial local',e);}}
function restorePersistentState(){try{const saved=JSON.parse(localStorage.getItem(PERSIST_KEY)||'null');if(!saved||saved.version!==3)return;state.savedSelected=saved.selected||null;state.marketBacktests=Array.isArray(saved.marketBacktests)?saved.marketBacktests:[];state.savedChartTrades=Array.isArray(saved.savedChartTrades)?saved.savedChartTrades:[];renderHistory(state.marketBacktests);}catch(e){console.warn('No se pudo restaurar el historial local',e);}}
const CANDIDATES = [
 ['1HZ10V','Volatility 10 (1s)'],['1HZ15V','Volatility 15 (1s)'],['1HZ25V','Volatility 25 (1s)'],['1HZ30V','Volatility 30 (1s)'],['1HZ50V','Volatility 50 (1s)'],['1HZ75V','Volatility 75 (1s)'],['1HZ90V','Volatility 90 (1s)'],['1HZ100V','Volatility 100 (1s)'],['1HZ150V','Volatility 150 (1s)'],['1HZ250V','Volatility 250 (1s)'],
 ['R_10','Volatility 10'],['R_25','Volatility 25'],['R_50','Volatility 50'],['R_75','Volatility 75'],['R_100','Volatility 100'],
 ['stpRNG','Step Index 100'],['CRASH500','Crash 500'],['BOOM500','Boom 500'],
 ['frxEURUSD','EUR/USD'],['frxGBPUSD','GBP/USD'],['frxUSDJPY','USD/JPY'],['frxAUDUSD','AUD/USD'],['frxUSDCAD','USD/CAD'],['frxUSDCHF','USD/CHF'],['frxNZDUSD','NZD/USD']
];
function setConnection(ok,msg){$('connectionDot').parentElement.classList.toggle('connected',ok);$('connectionText').textContent=msg;}
function connect(){
 return new Promise((resolve,reject)=>{
  if(state.ws && state.ws.readyState===1){resolve();return;}
  const ws=new WebSocket(API_URL); state.ws=ws;
  const timer=setTimeout(()=>reject(new Error('Tiempo de conexión agotado')),12000);
  ws.onopen=()=>{clearTimeout(timer);setConnection(false,'Validando Deriv…');resolve();};
  ws.onerror=()=>{clearTimeout(timer);setConnection(false,'Error de conexión');reject(new Error('No se pudo conectar a Deriv'));};
  ws.onclose=()=>{setConnection(false,'Deriv desconectada');for(const [,p] of state.pending)p.reject(new Error('Conexión cerrada'));state.pending.clear();};
  ws.onmessage=e=>{let m;try{m=JSON.parse(e.data);}catch(err){console.error('Respuesta Deriv no válida',err);return;}if(m.req_id&&state.pending.has(m.req_id)){const p=state.pending.get(m.req_id);state.pending.delete(m.req_id);m.error?p.reject(new Error(m.error.message)):p.resolve(m);}if(m.msg_type==='tick'&&m.tick)onLiveTick(m.tick);};
 });
}
function request(payload){return new Promise((resolve,reject)=>{if(!state.ws||state.ws.readyState!==1){reject(new Error('WebSocket no está conectado'));return;}const id=++state.req;const timer=setTimeout(()=>{if(state.pending.has(id)){state.pending.delete(id);reject(new Error('Deriv no respondió a tiempo: '+(payload.ticks_history||payload.active_symbols||'solicitud')));}},REQUEST_TIMEOUT_MS);state.pending.set(id,{resolve:m=>{clearTimeout(timer);resolve(m);},reject:e=>{clearTimeout(timer);reject(e);}});try{state.ws.send(JSON.stringify({...payload,req_id:id}));}catch(e){clearTimeout(timer);state.pending.delete(id);reject(e);}});}
async function loadSymbols(){
 await connect();const r=await request({active_symbols:'brief'});
 const all=r.active_symbols||[];
 // El panel siempre muestra los 25 instrumentos configurados; solo los activos se pueden seleccionar.
 const codeOf=s=>s.underlying_symbol||s.symbol||'';
 const nameOf=s=>s.underlying_symbol_name||s.display_name||'';
 const byCode=new Map(all.map(s=>[codeOf(s),s]));
 state.instrumentPanel=CANDIDATES.map(([code,label])=>{
  const s=byCode.get(code);
  return {symbol:code,name:s?(nameOf(s)||label):label,active:!!s,market:s?.market,submarket:s?.submarket};
 });
 state.symbols=state.instrumentPanel.filter(s=>s.active);
 if(!state.symbols.length){
  const sample=all.slice(0,12).map(x=>(nameOf(x)||'sin nombre')+' ['+(codeOf(x)||'?')+']').join(', ');
  throw new Error('Deriv respondió '+all.length+' símbolos, pero ninguno coincidió con los 25 configurados. Muestra: '+(sample||'catálogo vacío'));
 }
 $('instrumentCount').textContent=state.symbols.length+' activos / 25 configurados';
 state.selected=state.symbols[0].symbol;
 $('instrumentList').innerHTML=state.instrumentPanel.map(s=>'<button type="button" class="instrument-chip'+(s.symbol===state.selected?' selected':'')+'" data-symbol="'+esc(s.symbol)+'"'+(s.active?'':' disabled title="No disponible en esta cuenta de Deriv"')+'>'+esc(s.name)+(s.active?'':' · no disponible')+'</button>').join('');
 $('symbolSelect').innerHTML=state.instrumentPanel.map(s=>'<option value="'+esc(s.symbol)+'"'+(s.active?'':' disabled')+'>'+esc(s.name)+(s.active?'':' · no disponible')+'</option>').join('');
}

function esc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
async function getCandles(symbol,preferredCount=HISTORY_CANDLES){
 let lastError=null;const counts=[...new Set([HISTORY_CANDLES,Math.min(preferredCount,1440)])];
 for(const count of counts){
  try{const r=await request({ticks_history:symbol,adjust_start_time:1,count,end:'latest',granularity:60,style:'candles'});const candles=(r.candles||[]).map(c=>({time:Number(c.epoch),open:+c.open,high:+c.high,low:+c.low,close:+c.close})).filter(c=>Number.isFinite(c.time)&&Number.isFinite(c.open)&&Number.isFinite(c.high)&&Number.isFinite(c.low)&&Number.isFinite(c.close));if(candles.length)return candles;lastError=new Error('Deriv devolvió 0 velas para '+symbol);}catch(e){lastError=e;}
 }
 throw new Error('No se pudo descargar el historial de '+symbol+': '+(lastError?.message||'sin datos'));
}
function aggregate(candles,mins){if(mins===1)return candles;const groups=new Map();for(const candle of candles){const bucket=Math.floor(candle.time/(mins*60))*(mins*60);let g=groups.get(bucket);if(!g){g={time:bucket,open:candle.open,high:candle.high,low:candle.low,close:candle.close,count:0};groups.set(bucket,g);}g.high=Math.max(g.high,candle.high);g.low=Math.min(g.low,candle.low);g.close=candle.close;g.count++;}const lastBucket=candles.length?Math.floor(candles.at(-1).time/(mins*60))*(mins*60):null;return [...groups.values()].filter(g=>g.count===mins||g.time===lastBucket).map(({count,...bar})=>bar).sort((a,b)=>a.time-b.time);}
function ema(values,period){const out=Array(values.length).fill(null),k=2/(period+1);let prev=null;values.forEach((v,i)=>{prev=prev===null?v:v*k+prev*(1-k);out[i]=prev;});return out;}
function rsi(values,period=14){const out=Array(values.length).fill(null);let gain=0,loss=0;for(let i=1;i<values.length;i++){const d=values[i]-values[i-1];const g=Math.max(d,0),l=Math.max(-d,0);if(i<=period){gain+=g;loss+=l;if(i===period){gain/=period;loss/=period;out[i]=loss===0?100:100-100/(1+gain/loss);}}else{gain=(gain*(period-1)+g)/period;loss=(loss*(period-1)+l)/period;out[i]=loss===0?100:100-100/(1+gain/loss);}}return out;}
function pivots(c,span=3,candleSeconds=600){const highs=[],lows=[];for(let i=span;i<c.length-span;i++){let hi=true,lo=true;for(let j=1;j<=span;j++){if(c[i].high<=c[i-j].high||c[i].high<=c[i+j].high)hi=false;if(c[i].low>=c[i-j].low||c[i].low>=c[i+j].low)lo=false;}if(hi)highs.push({index:i,time:c[i].time,confirmedTime:c[i+span].time+candleSeconds,price:c[i].high});if(lo)lows.push({index:i,time:c[i].time,confirmedTime:c[i+span].time+candleSeconds,price:c[i].low});}const sample=c.slice(-30),avgRange=sample.length?sample.reduce((sum,v)=>sum+(v.high-v.low),0)/sample.length:0,tolerance=avgRange*.45;const merge=items=>{const kept=[];for(const p of items){const near=kept.findIndex(q=>Math.abs(q.price-p.price)<=tolerance);if(near<0)kept.push(p);else if(p.confirmedTime>kept[near].confirmedTime)kept[near]=p;}return kept.sort((a,b)=>a.time-b.time);};return{highs:merge(highs),lows:merge(lows)};}
function buildSetups(c,liquidityCandles=c,pivotCandles=liquidityCandles,obStructureCandles=pivotCandles,trendSide=null,targetRawCandles=pivotCandles){
 const close=c.map(x=>x.close),e9=ema(close,9),e20=ema(close,20),e50=ema(close,50),rv=rsi(close);
 const structureCandles=aggregate(targetRawCandles,state.pivotTf),structurePv=pivots(structureCandles,3,state.pivotTf*60);
 const m20Candles=aggregate(targetRawCandles,20),m20Pv=pivots(m20Candles,3,1200);
 const stopPivots=state.slTfs.map(mins=>({mins,pv:pivots(aggregate(targetRawCandles,mins),3,mins*60)}));
 const setups=[],latestZones=[],zoneKeys=new Set(),usedOBs=new Set(),usedZones=new Set();
 const primaryTf=state.obPrimaryTf,previousTf=state.obPreviousTf;
 const primaryCandles=aggregate(targetRawCandles,primaryTf),previousCandles=aggregate(targetRawCandles,previousTf);
 // Los OB se detectan de forma independiente de las entradas/RSI.
 // M30 define la dirección con EMA20/EMA50; M2 confirma con el cruce EMA9/EMA50.
 const m30Bars=aggregate(targetRawCandles,30),m30Close=m30Bars.map(v=>v.close);
 const m30E20=ema(m30Close,20),m30E50=ema(m30Close,50);
 const m30SideAt=time=>{
  let lo=0,hi=m30Bars.length;
  while(lo<hi){const mid=(lo+hi)>>1;if(m30Bars[mid].time+1800<=time)lo=mid+1;else hi=mid;}
  const k=lo-1;
  if(k<49)return null;
  return m30E20[k]>m30E50[k]?'BUY':m30E20[k]<m30E50[k]?'SELL':null;
 };
 const m2Bars=aggregate(targetRawCandles,2),m2Close=m2Bars.map(v=>v.close);
 const m2E9=ema(m2Close,9),m2E50=ema(m2Close,50);
 const addZone=(found,side,tf)=>{
  if(!found)return;
  const ob=found.ob||found;
  const key=side+':'+tf+':'+ob.time;
  if(zoneKeys.has(key))return;
  latestZones.push({...ob,side,timeframe:tf,structureTime:ob.time,structureType:side==='BUY'?'SOPORTE':'RESISTENCIA'});
  zoneKeys.add(key);
 };
 for(let i=50;i<m2Bars.length;i++){
  const bar=m2Bars[i],prior=m2E9[i-1]-m2E50[i-1],current=m2E9[i]-m2E50[i];
  const side=prior<=0&&current>0?'BUY':prior>=0&&current<0?'SELL':null;
  if(!side||m30SideAt(bar.time+120)!==side)continue;
  const primary=findOBAtTime(primaryCandles,bar.time+120,side,primaryTf);
  addZone(primary,side,primaryTf);
  if(state.obPreviousEnabled){
   const previous=findOBAtTime(previousCandles,bar.time+120,side,previousTf);
   addZone(previous,side,previousTf);
  }
 }

 for(let i=50;i<c.length;i++){
  const x=c[i],prior=e9[i-1]-e50[i-1],current=e9[i]-e50[i];
  const side=prior<=0&&current>0?'BUY':prior>=0&&current<0?'SELL':null;
  if(!side||m30SideAt(x.time+120)!==side)continue;
  const ob=findOBAtTime(primaryCandles,x.time+120,side,primaryTf);
  if(!ob)continue;
  const key=side+':'+ob.time,zoneKey=side+':'+ob.time;
  if(usedOBs.has(key)||usedZones.has(zoneKey))continue;
  const previous=state.obPreviousEnabled?findOBAtTime(previousCandles,x.time+120,side,previousTf):null;
  const levels=(side==='BUY'?m20Pv.highs:m20Pv.lows)
   .filter(p=>p.confirmedTime<=x.time&&(side==='BUY'?p.price>x.close:p.price<x.close))
   .map(p=>({...p,timeframe:20}))
   .sort((a,b)=>side==='BUY'?a.price-b.price:b.price-a.price)
   .filter((p,index,all)=>all.findIndex(q=>Math.abs(q.price-p.price)<=Math.max(1e-10,Math.abs(p.price)*1e-8))===index);
  const stopCandidates=stopPivots.flatMap(({mins,pv:stopPv})=>(side==='BUY'?stopPv.lows:stopPv.highs)
   .filter(p=>p.confirmedTime<=x.time&&(side==='BUY'?p.price<x.close:p.price>x.close))
   .map(p=>({...p,timeframe:mins})))
   .sort((a,b)=>side==='BUY'?b.price-a.price:a.price-b.price);
  const slPivot=stopCandidates[0]||null,tp1Pivot=levels[0]||null,tp2Pivot=levels[1]||null;
  const risk=Math.max(ob.high-ob.low,Math.abs(x.close)*.0001);
  const sl=slPivot?(side==='BUY'?slPivot.price-risk*.12:slPivot.price+risk*.12):(side==='BUY'?ob.low-risk*.12:ob.high+risk*.12);
  const tp1=tp1Pivot?tp1Pivot.price:(side==='BUY'?x.close+risk*1.5:x.close-risk*1.5);
  const tp2=tp2Pivot?tp2Pivot.price:(side==='BUY'?x.close+risk*2.5:x.close-risk*2.5);
  setups.push({side,index:i,time:x.time,entry:x.close,sl,tp1,tp2,ob,structureTime:ob.time,structurePrice:side==='BUY'?ob.low:ob.high,slPivot,tp1Pivot,tp2Pivot,rsi:rv[i],strongCandle:false,state:'PREPARADA',previousOB:previous||null});
  addZone(ob,side,primaryTf);if(previous)addZone(previous,side,previousTf);
  usedOBs.add(key);usedZones.add(zoneKey);
 }
 return{setups,e9,e20,e50,rv,pv:m20Pv,obZones:latestZones.sort((a,b)=>a.time-b.time)};
}
function findValidOBAtTime(c,time,side,tf,pv,structureCandles,raw){
 let lo=0,hi=c.length;
 while(lo<hi){const mid=(lo+hi)>>1;if(c[mid].time+tf*60<=time)lo=mid+1;else hi=mid;}
 for(let j=lo-1;j>=Math.max(0,lo-12);j--){
  const q=c[j],opposite=side==='BUY'?q.close<q.open:q.close>q.open;
  if(!opposite)continue;
  const ob={time:q.time,high:q.high,low:q.low,entry:(q.high+q.low)/2};
  const structure=findPivotStructure(ob,side,pv,structureCandles,time);
  if(structure&&!isOBInvalidated(ob,side,structure,raw,time))return{ob,structure};
 }
 return null;
}
function findPivotStructure(ob,side,pv,candles,time){
 // Exige dos pivotes confirmados de la temporalidad elegida: resistencia para venta y soporte para compra.
 // El OB se ancla al más reciente de esos dos extremos, no a cualquier pivote antiguo.
 const levels=(side==='BUY'?pv.lows:pv.highs)
  .filter(p=>p.confirmedTime<=time)
  .sort((a,b)=>a.time-b.time);
 if(levels.length<2)return null;
 const lastTwo=levels.slice(-2),p=lastTwo[1];
 const bar=candles[p.index];if(!bar)return null;
 const tolerance=Math.max((bar.high-bar.low)*.45,(ob.high-ob.low)*1.5);
 if(p.price<ob.low-tolerance||p.price>ob.high+tolerance)return null;
 return{...p,tolerance,previousPrice:lastTwo[0].price,previousTime:lastTwo[0].time};
}
function isOBInvalidated(ob,side,structure,raw,time){
 let lo=0,hi=raw.length;
 while(lo<hi){const mid=(lo+hi)>>1;if(raw[mid].time<structure.confirmedTime)lo=mid+1;else hi=mid;}
 for(let i=lo;i<raw.length&&raw[i].time<=time;i++){const bar=raw[i];if(side==='SELL'?bar.close>structure.price:bar.close<structure.price)return true;}
 return false;
}
function findOBAtTime(c,time,side,tf=state.obTf){const completed=c.filter(bar=>bar.time+tf*60<=time);return findOB(completed,completed.length,side);}
function findOB(c,i,side){for(let j=i-1;j>=Math.max(0,i-9);j--){const q=c[j],opposite=side==='BUY'?q.close<q.open:q.close>q.open;if(opposite){const entry=(q.high+q.low)/2;return{time:q.time,high:q.high,low:q.low,entry};}}return null;}
function simulate(c,setups){
 const trades=[],entryRsiValues=rsi(c.map(x=>x.close));
 for(const s of setups){
  let entered=true,result='PENDIENTE',entryIndex=s.index,entryTime=s.time,exitTime=null,exitPrice=null,cancelReason=null;
  // La señal se confirma en el cierre de la vela; si el cuerpo es >=70% del rango,
  // se considera detonante fuerte y la entrada queda marcada como inmediata.
  for(let j=s.index+1;j<c.length;j++){
   const k=c[j],slHit=s.side==='BUY'?k.low<=s.sl:k.high>=s.sl;
   const tp1Hit=s.side==='BUY'?k.high>=s.tp1:k.low<=s.tp1;
   const tp2Hit=s.side==='BUY'?k.high>=s.tp2:k.low<=s.tp2;
   if(slHit){result='PERDIDA';exitPrice=s.sl;exitTime=k.time;break;}
   if(tp2Hit){result='GANADA';exitPrice=s.tp2;exitTime=k.time;break;}
   if(tp1Hit){result='GANADA';exitPrice=s.tp1;exitTime=k.time;break;}
  }
  const points=exitPrice==null?null:(s.side==='BUY'?exitPrice-s.entry:s.entry-exitPrice);
  trades.push({...s,result,entryIndex,entryTime,entryRsi:entryRsiValues[entryIndex],exitTime,exitPrice,points,cancelReason});
 }
 return trades;
}
function buildTradeMarkers(){return [];}
function draw(c,calc,trades,obZones=[],setups=[]){
 // Limpieza defensiva: ninguna EMA puede permanecer como serie visual del precio.
 for(const key of ['ema3','ema9','ema13','ema21']){if(state.series[key]&&state.main){try{state.main.removeSeries(state.series[key]);}catch{}}delete state.series[key];}
 const chartKey=state.selected+'|'+state.tf;const priorRange=state.main?state.main.timeScale().getVisibleLogicalRange():null;const preserveRange=!!priorRange&&!state.forceFitNext;
 if(!window.LightweightCharts){$('mainChart').innerHTML='<div class="chart-placeholder">No se pudo cargar el motor del gráfico. Comprueba tu conexión e intenta actualizar.</div>';throw new Error('No cargó Lightweight Charts desde el CDN');}
 if(state.overlayResizeObserver){state.overlayResizeObserver.disconnect();state.overlayResizeObserver=null;}
 if(state.main&&state.rsi&&state.chartKey===chartKey){
  const lineData=values=>values.map((v,i)=>v==null?null:{time:c[i].time,value:v}).filter(Boolean);
  state.series.candle.setData(c);state.series.rsi.setData(lineData(calc.rv));
  const emaLineData=values=>values.map((v,i)=>v==null?null:{time:c[i].time,value:v}).filter(Boolean);
  if(!state.series.ema20)state.series.ema20=state.main.addSeries(LightweightCharts.LineSeries,{color:'#f4c542',lineWidth:2,priceLineVisible:false,lastValueVisible:true,title:'EMA 20'});
  if(!state.series.ema50)state.series.ema50=state.main.addSeries(LightweightCharts.LineSeries,{color:'#43a5ff',lineWidth:2,priceLineVisible:false,lastValueVisible:true,title:'EMA 50'});
  state.series.ema20.setData(emaLineData(calc.e20));state.series.ema50.setData(emaLineData(calc.e50));
  drawPivotLines();if(state.markerPlugin)state.markerPlugin.setMarkers([]);
  const latest=trades.slice(-1)[0];drawOverlays(trades,c,$('mainChart'),obZones,setups);
  if(state.forceFitNext){const visibleFrom=Math.max(0,c.length-550);const visibleRange={from:visibleFrom,to:c.length+3};state.main.timeScale().setVisibleLogicalRange(visibleRange);state.rsi.timeScale().setVisibleLogicalRange(visibleRange);}else if(priorRange){state.main.timeScale().setVisibleLogicalRange(priorRange);state.rsi.timeScale().setVisibleLogicalRange(priorRange);}state.forceFitNext=false;return;
 }
 if(state.main){state.main.remove();if(state.rsi)state.rsi.remove();}state.overlayUpdate=null;state.overlayRangeHandler=null;
 const L=LightweightCharts,main=$('mainChart');main.innerHTML='';
 state.chartKey=chartKey;state.main=L.createChart(main,{autoSize:true,layout:{background:{type:'solid',color:'#0b121e'},textColor:'#9aaac0',fontSize:6},grid:{vertLines:{color:'#172235'},horzLines:{color:'#172235'}},rightPriceScale:{borderColor:'#28364a'},timeScale:{borderColor:'#28364a',timeVisible:true,secondsVisible:false},handleScroll:{mouseWheel:true,pressedMouseMove:true,horzTouchDrag:true,vertTouchDrag:true},handleScale:{mouseWheel:true,pinch:true,axisPressedMouseMove:true}});
 const candle=state.main.addSeries(L.CandlestickSeries,{upColor:'#19c99a',downColor:'#ff5968',borderVisible:false,wickUpColor:'#19c99a',wickDownColor:'#ff5968',autoscaleInfoProvider:original=>{const info=original();const levels=state.overlayPriceLevels.filter(Number.isFinite);if(!info||!info.priceRange||!levels.length)return info;return{...info,priceRange:{minValue:Math.min(info.priceRange.minValue,...levels),maxValue:Math.max(info.priceRange.maxValue,...levels)}};}});state.series.candle=candle;
 candle.setData(c);
 state.series.ema20=state.main.addSeries(L.LineSeries,{color:'#f4c542',lineWidth:2,priceLineVisible:false,lastValueVisible:true,title:'EMA 20'});
 state.series.ema50=state.main.addSeries(L.LineSeries,{color:'#43a5ff',lineWidth:2,priceLineVisible:false,lastValueVisible:true,title:'EMA 50'});
 const emaLineData=values=>values.map((v,i)=>v==null?null:{time:c[i].time,value:v}).filter(Boolean);
 state.series.ema20.setData(emaLineData(calc.e20));state.series.ema50.setData(emaLineData(calc.e50));
 drawPivotLines();
 if(typeof L.createSeriesMarkers==='function'){state.markerPlugin=L.createSeriesMarkers(candle,[]);}else{state.markerPlugin=null;}
 const latest=trades.slice(-1)[0];
 drawOverlays(trades,c,main,obZones,setups);
 const rsiEl=$('rsiChart');rsiEl.innerHTML='';
 state.rsi=L.createChart(rsiEl,{autoSize:true,layout:{background:{type:'solid',color:'#0b121e'},textColor:'#8b9bb0',fontSize:10},grid:{vertLines:{color:'#172235'},horzLines:{color:'#172235'}},rightPriceScale:{borderColor:'#28364a'},timeScale:{visible:false},handleScroll:{mouseWheel:true,pressedMouseMove:true,horzTouchDrag:true},handleScale:{mouseWheel:true,pinch:true}});
 const rs=state.rsi.addSeries(L.LineSeries,{color:'#b58aff',lineWidth:2,priceLineVisible:false,lastValueVisible:true,priceFormat:{type:'price',precision:1,minMove:.1},autoscaleInfoProvider:()=>({priceRange:{minValue:0,maxValue:100}})});state.series.rsi=rs;rs.setData(calc.rv.map((v,i)=>v==null?null:{time:c[i].time,value:v}).filter(Boolean));
 [30,50,70].forEach(v=>rs.createPriceLine({price:v,color:'#45536b',lineStyle:L.LineStyle.Dashed,lineWidth:1,axisLabelVisible:true,title:''}));
 if(preserveRange){state.main.timeScale().setVisibleLogicalRange(priorRange);state.rsi.timeScale().setVisibleLogicalRange(priorRange);}else{const visibleFrom=Math.max(0,c.length-120);const visibleRange={from:visibleFrom,to:c.length+3};state.main.timeScale().setVisibleLogicalRange(visibleRange);state.rsi.timeScale().setVisibleLogicalRange(visibleRange);}let syncingRange=false;state.main.timeScale().subscribeVisibleLogicalRangeChange(range=>{if(!range||syncingRange)return;syncingRange=true;state.rsi.timeScale().setVisibleLogicalRange(range);syncingRange=false;});state.rsi.timeScale().subscribeVisibleLogicalRangeChange(range=>{if(!range||syncingRange)return;syncingRange=true;state.main.timeScale().setVisibleLogicalRange(range);syncingRange=false;});state.forceFitNext=false;
}
function drawPivotLines(){
 if(!state.series.candle||!state.rawCandles.length)return;
 for(const line of state.pivotLines){try{state.series.candle.removePriceLine(line);}catch{}}
 state.pivotLines=[];
 const raw=state.rawCandles,current=Number(raw[raw.length-1].close);
 if(!Number.isFinite(current))return;
 const colors={1:'#8b9cff',2:'#d18cff',3:'#55c9d8',4:'#e2b65c',5:'#35c99a',10:'#ff8b65',30:'#c084fc',60:'#f472b6'};
 const L=window.LightweightCharts;
 for(const mins of [1,2,3,4,5,10,30,60]){
  if(!state.pivotTfEnabled[mins])continue;
  const candles=aggregate(raw,mins);
  if(!candles.length)continue;
  const detected=pivots(candles,3,mins*60);
  const highs=detected.highs.filter(p=>Number.isFinite(p.price)&&p.price>current);
  const lows=detected.lows.filter(p=>Number.isFinite(p.price)&&p.price<current);
  let resistance=highs.sort((a,b)=>a.price-b.price)[0];
  let support=lows.sort((a,b)=>b.price-a.price)[0];
  if(!resistance){
   const candidates=candles.map(bar=>({time:bar.time,price:bar.high}));
   resistance=candidates.reduce((best,p)=>!best||p.price>best.price?p:best,null);
   if(resistance&&resistance.price<=current)resistance=null;
  }
  if(!support){
   const candidates=candles.map(bar=>({time:bar.time,price:bar.low}));
   support=candidates.reduce((best,p)=>!best||p.price<best.price?p:best,null);
   if(support&&support.price>=current)support=null;
  }
  const color=colors[mins];
  for(const pair of [[resistance,true],[support,false]]){
   const p=pair[0],isResistance=pair[1];
   if(!p||!Number.isFinite(p.price))continue;
   const line=state.series.candle.createPriceLine({price:p.price,color,lineWidth:1,lineStyle:isResistance?L.LineStyle.Dashed:L.LineStyle.Dotted,axisLabelVisible:true,title:(isResistance?'Resistencia ':'Pivote ')+(mins===60?'1h':mins+'m')});
   state.pivotLines.push(line);
  }
 }
}
function drawOverlays(trades,c,host,obZones=[],setups=[]){
  for(const line of state.tradePriceLines){try{state.series.candle.removePriceLine(line);}catch{}}
  state.tradePriceLines=[];
  if(state.overlayResizeObserver){state.overlayResizeObserver.disconnect();state.overlayResizeObserver=null;}
  host.querySelectorAll('.chart-overlay').forEach(node=>node.remove());state.overlayUpdate=null;
  const overlay=document.createElement('div');overlay.className='chart-overlay';host.appendChild(overlay);
  const closedTrades=(trades||[]).filter(x=>(x.result==='GANADA'||x.result==='PERDIDA')&&Number.isFinite(x.points));
  const wonPoints=closedTrades.filter(x=>x.result==='GANADA').reduce((sum,x)=>sum+Math.max(0,x.points),0);
  const lostPoints=closedTrades.filter(x=>x.result==='PERDIDA').reduce((sum,x)=>sum+Math.abs(Math.min(0,x.points)),0);
  const wonEl=$('chartWonPoints'),lostEl=$('chartLostPoints');
  if(wonEl)wonEl.textContent='+'+fmt(wonPoints)+' pts';
  if(lostEl)lostEl.textContent='-'+fmt(lostPoints)+' pts';
  const lockedTrade=[...(trades||[])].reverse().find(x=>['ESPERANDO DOJI','ESPERANDO CAMBIO','PENDIENTE'].includes(x.result));
  const zones=[...(obZones||[]),...(lockedTrade&&lockedTrade.ob?[{...lockedTrade.ob,side:lockedTrade.side,timeframe:state.obPrimaryTf,structureTime:lockedTrade.structureTime}]:[])].filter((ob,i,all)=>ob&&Number.isFinite(ob.time)&&all.findIndex(q=>q.time===ob.time&&q.side===ob.side)===i).sort((x,y)=>x.time-y.time);
  const zoneEls=zones.map(ob=>{
    const el=document.createElement('div');el.className='ob-zone '+(ob.fvg?'fvg-zone ':'')+(ob.side==='BUY'?'bull-zone':'bear-zone');
    el.textContent=ob.side==='BUY'?'OB ALCISTA':'OB BAJISTA';overlay.appendChild(el);return{el,ob};
  });
  const t=[...trades].reverse().find(x=>['ESPERANDO DOJI','ESPERANDO CAMBIO','PENDIENTE'].includes(x.result))||[...setups].reverse()[0]||trades[trades.length-1];
  const overrideKey=t?String(state.selected||'')+':'+String(t.time)+':'+t.side:null;
  if(t&&overrideKey&&state.levelOverrides[overrideKey])Object.assign(t,state.levelOverrides[overrideKey]);
  const entryRecords=(trades||[]).filter(x=>Number.isFinite(x.entry)&&Number.isFinite(x.entryTime)&&x.entryIndex>=0&&x.result!=='CANCELADA');
  const currentPending=t&&t.entryIndex<0&&!Number.isFinite(t.entryTime)?[t]:[];
  const visibleEntries=[...entryRecords,...currentPending].slice(-550);
  state.overlayPriceLevels=t?[t.entry,t.sl,t.tp1,t.tp2].filter(Number.isFinite):[];
  const entryEls=[],levelEls=[];
  visibleEntries.forEach((trade,index)=>{
    const time=Number.isFinite(trade.entryTime)?trade.entryTime:trade.time;
    const label=trade.side==='BUY'?'COMPRA':'VENTA';
    const entry=document.createElement('div');entry.className='price-label entry-line';
    entry.setAttribute('aria-label','Entrada '+label+' '+fmt(trade.entry));
    entry.innerHTML='<b>'+label+'</b><strong>'+fmt(trade.entry)+'</strong><small>RSI '+fmt(Number.isFinite(trade.entryRsi)?trade.entryRsi:trade.rsi)+'</small>';
    overlay.appendChild(entry);entryEls.push({p:trade.entry,time,el:entry});
    const tp2Reached=trade.result==='GANADA'&&Number.isFinite(trade.exitPrice)&&Math.abs(trade.exitPrice-trade.tp1)<=Math.max(1e-10,Math.abs(trade.tp1)*1e-8);
    const levels=[['SL',trade.sl,'sl-line'],['TP1',trade.tp1,'tp-line']];
    if(Number.isFinite(Number(trade.tp2))&&!tp2Reached&&Math.abs(Number(trade.tp2)-Number(trade.tp1))>Math.max(1e-10,Math.abs(Number(trade.tp1))*1e-8))levels.push(['TP2',trade.tp2,'tp2-line']);
    levels.forEach(([name,price,cls])=>{
      if(!Number.isFinite(Number(price)))return;
      const tag=document.createElement('div');tag.className='price-label '+cls;
      tag.setAttribute('aria-label',name+' '+fmt(Number(price)));
      tag.innerHTML='<b>'+name+'</b><strong>'+fmt(Number(price))+'</strong>';
      overlay.appendChild(tag);levelEls.push({p:Number(price),time,tag});
    });
  });
  const update=()=>{
    const width=host.clientWidth,scale=state.main.timeScale(),candleSeries=state.series.candle;
    zoneEls.forEach(({el,ob})=>{
      const x=scale.timeToCoordinate(ob.time);
      const y1=candleSeries.priceToCoordinate(ob.high),y2=candleSeries.priceToCoordinate(ob.low);
      // Si la vela no está visible, se oculta: nunca se pega el OB al borde del gráfico.
      if(x==null||x<0||x>width||y1==null||y2==null){el.style.display='none';return;}
      const boxWidth=Math.min(window.innerWidth<=600?126:150,Math.max(0,width-x-8));
      if(boxWidth<24){el.style.display='none';return;}
      el.style.display='flex';el.style.left=x+'px';el.style.width=boxWidth+'px';
      el.style.top=((y1+y2)/2-15)+'px';el.style.height='30px';
    });
    entryEls.forEach(v=>{
      const y=candleSeries.priceToCoordinate(v.p),x=scale.timeToCoordinate(v.time);
      if(y==null||x==null||x<0||x>width){v.el.style.display='none';return;}
      v.el.style.display='flex';v.el.style.width='max-content';
      const w=v.el.offsetWidth||100;
      v.el.style.left=Math.max(0,Math.min(width-w,x-w/2))+'px';
      v.el.style.top=(y-(v.el.offsetHeight/2))+'px';
    });
    levelEls.forEach(v=>{
      const y=candleSeries.priceToCoordinate(v.p),x=scale.timeToCoordinate(v.time);
      if(y==null||x==null||x<0||x>width){v.tag.style.display='none';return;}
      v.tag.style.display='flex';v.tag.style.width='max-content';
      const w=v.tag.offsetWidth||70;
      v.tag.style.left=Math.max(0,Math.min(width-w,x+7))+'px';
      v.tag.style.top=(y-(v.tag.offsetHeight/2))+'px';
    });
  };
  state.overlayUpdate=update;
  if(!state.overlayRangeHandler){state.overlayRangeHandler=()=>{
    if(state.overlayFrame)return;
    state.overlayFrame=requestAnimationFrame(()=>{state.overlayFrame=0;if(state.overlayUpdate)state.overlayUpdate();});
  };state.main.timeScale().subscribeVisibleLogicalRangeChange(state.overlayRangeHandler);}
  if(window.ResizeObserver){state.overlayResizeObserver=new ResizeObserver(update);state.overlayResizeObserver.observe(host);}
  requestAnimationFrame(update);
}
function fmt(n){return Number.isFinite(n)?Number(n).toFixed(2):'—';}
function getTrend30(raw){
 const m30=aggregate(raw,30),latest=raw.length?raw[raw.length-1].time:0;
 const closed=m30.filter(bar=>bar.time+1800<=latest);
 if(closed.length<50)return{trend:'SIN DATOS M30',side:null,ob:null,m30:closed};
 const close=closed.map(x=>x.close),fast=ema(close,20),slow=ema(close,50);
 const side=fast.at(-1)>slow.at(-1)?'BUY':fast.at(-1)<slow.at(-1)?'SELL':null;
 const trend=side==='BUY'?'ALCISTA':side==='SELL'?'BAJISTA':'LATERAL';
 const ob=side?findOB(closed,closed.length,side):null;
 return{trend,side,ob,m30:closed};
}
function showLatest(calc,trades,c,raw=state.rawCandles){
 const t=trades.filter(x=>x.result==='PENDIENTE').slice(-1)[0]||trades.slice(-1)[0],rv=calc.rv[calc.rv.length-1];
 const hourly=getTrend30(raw),trend=hourly.trend;
 $('trendValue').textContent=trend;$('trendValue').style.color=trend==='BAJISTA'?'#ff6876':trend==='ALCISTA'?'#20d69a':'#d5b35b';
 const obLabel=hourly.side?(hourly.side==='BUY'?'OB ALCISTA':'OB BAJISTA'):'SIN OB · M30 LATERAL';
 $('signalValue').textContent=obLabel;
 $('signalValue').style.color=hourly.side?(hourly.side==='BUY'?'#20d69a':'#ff6876'):'#aab8ca';
 $('entryValue').textContent=t?fmt(t.entry):'—';if($('slValue'))$('slValue').textContent=t?fmt(t.sl):'—';if($('tp1Value'))$('tp1Value').textContent=t?fmt(t.tp1):'—';if($('tp2Value'))$('tp2Value').textContent=t?fmt(t.tp2):'—';$('rsiValue').textContent=fmt(rv);
 $('rsiConfirm').textContent=t?'CRUCE EMA9/EMA50 M2 + TENDENCIA M30 + OB':'Sin señal';$('rsiConfirm').style.color=t?'#20d69a':'#8b9bb0';
 $('signalState').textContent=t?(t.entryIndex>=0?'ACTIVA':'PREPARADA'):'ESPERANDO';
 $('signalDetails').textContent=(hourly.side?'Sesgo de 30 minutos: '+trend+'. Mostrando únicamente el '+obLabel+' de M30'+(hourly.ob?' entre '+fmt(hourly.ob.low)+' y '+fmt(hourly.ob.high):' (zona no localizada en las últimas 9 velas H1)')+'. ':'La tendencia H1 está lateral; no se selecciona OB direccional. ')+(t?(t.entryIndex>=0?'Operación ACTIVA. ':'')+(t.side==='BUY'?'OB alcista':'OB bajista')+' alineado con la tendencia M30. Entrada en el OB; TP1 es la primera resistencia/soporte disponible de M3, M5 o M10. Entrada proyectada '+fmt(t.entry)+', SL '+fmt(t.sl)+', TP1 '+fmt(t.tp1)+' y TP2 '+fmt(t.tp2)+'.':'No hay una señal completa en la última vela M2.');
 $('rsiLegend').textContent='Valor actual: '+fmt(rv);
}
function renderHistory(trades){
 const source=mergeTrades(state.marketBacktests,state.savedChartTrades.length?state.savedChartTrades:(trades||[]),2000);
 const rows=[...source].sort((a,b)=>Number(a.time)-Number(b.time)).slice(-550).reverse();
 const shown=Math.min(rows.length,550);
 $('historyCount').textContent='Mostrando '+shown+' de '+source.length+' · +'+fmt(source.filter(t=>t.result==='GANADA'&&Number.isFinite(t.points)).reduce((a,t)=>a+Math.max(0,t.points),0))+' / -'+fmt(source.filter(t=>t.result==='PERDIDA'&&Number.isFinite(t.points)).reduce((a,t)=>a+Math.abs(Math.min(0,t.points)),0))+' pts';
 $('historyBody').innerHTML=rows.length?rows.map(t=>'<tr><td>'+new Date(t.time*1000).toLocaleTimeString('es-PA',{hour:'2-digit',minute:'2-digit'})+'</td><td>'+esc(state.symbols.find(x=>x.symbol===t.symbol)?.name||t.symbol||state.selected)+'</td><td style="color:'+(t.side==='BUY'?'#20d69a':'#ff6876')+'">'+(t.side==='BUY'?'COMPRA':'VENTA')+'</td><td>'+fmt(t.entry)+'</td><td>'+fmt(Number.isFinite(t.entryRsi)?t.entryRsi:t.rsi)+'</td><td>'+fmt(t.sl)+'</td><td>'+fmt(t.tp1)+'</td><td>'+fmt(t.tp2)+'</td><td>'+t.result+'</td><td style="color:'+(t.points==null?'#8b9bb0':t.points>=0?'#20d69a':'#ff6876')+'">'+(t.points==null?'—':(t.points>0?'+':'')+fmt(t.points)+' pts')+'</td></tr>').join(''):'<tr><td colspan="10" class="empty-cell">No hay operaciones detectadas en este período.</td></tr>';
 const closed=source.filter(t=>t.result==='GANADA'||t.result==='PERDIDA');
 $('wins').textContent=closed.filter(t=>t.result==='GANADA').length;$('losses').textContent=closed.filter(t=>t.result==='PERDIDA').length;$('pending').textContent=source.filter(t=>t.result==='PENDIENTE').length;$('expired').textContent=source.filter(t=>t.result==='CANCELADA').length;
}
async function runUniverseBacktest(refresh=false){
 if(!state.rawCandles.length)$('dataStatus').textContent='Preparando análisis de 24 horas…';
 if(refresh){state.rawBySymbol.clear();state.downloadErrors=[];}else if(!state.downloadErrors)state.downloadErrors=[];
 let cursor=0,done=0;const workers=Array.from({length:Math.min(4,state.symbols.length)},async()=>{
  while(cursor<state.symbols.length){const item=state.symbols[cursor++];try{if(refresh||!state.rawBySymbol.has(item.symbol)||(state.rawBySymbol.get(item.symbol)||[]).length<HISTORY_CANDLES){const raw=await getCandles(item.symbol,1440);state.rawBySymbol.set(item.symbol,raw);}done++;$('backtestInfo').textContent='Descargando historial: '+done+' / '+state.symbols.length+' instrumentos…';}catch(e){state.rawBySymbol.set(item.symbol,[]);if(!state.downloadErrors)state.downloadErrors=[];state.downloadErrors.push(item.name+': '+e.message);if(!state.rawBySymbol.has(item.symbol))state.rawBySymbol.set(item.symbol,[]);done++;$('backtestInfo').textContent='Descargas '+done+' / '+state.symbols.length+' · falló '+item.name;}}
 });
 await Promise.all(workers);
 const allTrades=[],shortHistory=[];
 for(const item of state.symbols){const source=state.rawBySymbol.get(item.symbol)||[];if(!source.length)continue;const cutoff=source.length?source[0].time:Math.floor(Date.now()/1000)-HISTORY_CANDLES*60;const raw=source.filter(v=>v.time>=cutoff);if(raw.length<HISTORY_CANDLES)shortHistory.push(item.name+' ('+raw.length+' velas/24h)');const candles=aggregate(raw,2);if(candles.length<70)continue;const hourly=getTrend30(raw),obCandles=raw,pivotCandles=aggregate(raw,state.pivotTf),calc=buildSetups(candles,obCandles,pivotCandles,pivotCandles,null,raw),setups=calc.setups,trades=simulate(candles,setups);allTrades.push(...trades.map(t=>({...t,symbol:item.symbol})));}
 state.marketBacktests=mergeTrades(state.marketBacktests,allTrades,2000);
 state.savedChartTrades=mergeTrades(state.savedChartTrades,allTrades,2000);
 state.trades=state.savedChartTrades.filter(t=>t.symbol===state.selected);
 // Al terminar el backtest, vuelve a pintar el gráfico con las entradas históricas recién guardadas.
 const currentRaw=state.rawBySymbol.get(state.selected)||state.rawCandles;
 if(currentRaw.length&&state.main){
  state.rawCandles=currentRaw;const chartCandles=aggregate(currentRaw,state.tf),signalCandles=aggregate(currentRaw,2),pivotCandles=aggregate(currentRaw,state.pivotTf),hourly=getTrend30(currentRaw);
  const chartCalc=buildSetups(chartCandles,currentRaw,pivotCandles,pivotCandles,null,currentRaw);
  const signalCalc=buildSetups(signalCandles,currentRaw,pivotCandles,pivotCandles,null,currentRaw);
  const aligned=signalCalc.setups;
  state.candles=chartCandles;draw(chartCandles,chartCalc,state.trades,chartCalc.obZones,aligned);showLatest(signalCalc,state.trades,signalCandles);
 }
 if(state.markerPlugin)state.markerPlugin.setMarkers([]);
 savePersistentState();
 renderHistory(state.marketBacktests);
 const closed=allTrades.filter(t=>t.result==='GANADA'||t.result==='PERDIDA');
 $('wins').textContent=closed.filter(t=>t.result==='GANADA').length;$('losses').textContent=closed.filter(t=>t.result==='PERDIDA').length;
 $('pending').textContent=allTrades.filter(t=>t.result==='PENDIENTE').length;$('expired').textContent=allTrades.filter(t=>t.result==='CANCELADA').length;
 const failed=state.downloadErrors.length;$('backtestInfo').textContent='Universo: '+state.symbols.length+' instrumentos · señales M2 · gráfico M'+state.tf+' · período: últimas 72 horas · '+allTrades.length+' señales simuladas · '+failed+' descargas fallidas · '+shortHistory.length+' con historial parcial'+(failed?'. Errores: '+state.downloadErrors.slice(0,2).join(' | '):'')+(shortHistory.length?'. Parciales: '+shortHistory.slice(0,3).join(', '):'.');
}
async function analyze(){
 if(state.busy){state.analyzeQueued=true;return;}state.busy=true;$('dataStatus').textContent='Cargando gráfico…';
 try{const raw=state.rawBySymbol.get(state.selected)||await getCandles(state.selected,1440);if(!raw.length)throw new Error('No llegaron velas para '+state.selected);state.rawBySymbol.set(state.selected,raw);
 state.rawCandles=raw;state.lastRecalcBucket=Math.floor(raw.at(-1).time/120);const c=aggregate(raw,state.tf);state.candles=c;const signalCandles=aggregate(raw,2);const obCandles=raw;const pivotCandles=aggregate(raw,state.pivotTf);
 const hourly=getTrend30(raw);const signalCalc=buildSetups(signalCandles,obCandles,pivotCandles,pivotCandles,null,raw);const chartCalc=buildSetups(c,obCandles,pivotCandles,pivotCandles,hourly.side,raw);
 // Una sola dirección gobierna las señales y los OB visibles: la tendencia M30.
 const alignedSetups=hourly.side?signalCalc.setups.filter(setup=>setup.side===hourly.side):[];
 const alignedZones=chartCalc.obZones;
 const freshTrades=simulate(signalCandles,alignedSetups).map(t=>({...t,symbol:state.selected}));
 state.savedChartTrades=mergeTrades(state.savedChartTrades,freshTrades,2000);
 state.trades=state.savedChartTrades.filter(t=>t.symbol===state.selected);
 savePersistentState();
 draw(c,chartCalc,state.trades,alignedZones,alignedSetups);showLatest(signalCalc,state.trades.filter(t=>t.symbol===state.selected),signalCandles);renderHistory(state.trades);
 $('chartTitle').textContent=(state.symbols.find(s=>s.symbol===state.selected)?.name||state.selected)+' · M'+state.tf;
 $('chartSubtitle').textContent='Velas '+c.length+' · últimas 72 horas · OB históricos';
 $('chartRange').textContent='Últimas 72 horas · '+new Date(c[0].time*1000).toLocaleTimeString('es-PA')+' — '+new Date(c.at(-1).time*1000).toLocaleTimeString('es-PA');
 $('dataStatus').textContent='Datos actualizados · '+raw.length+' velas M1';
 }catch(e){$('dataStatus').textContent='ERROR DE DATOS: '+e.message;$('signalDetails').textContent='No se pudo cargar este instrumento. '+e.message;}finally{state.busy=false;if(state.analyzeQueued){state.analyzeQueued=false;Promise.resolve().then(analyze);}}
}
function scheduleRecalculation(){
 $('dataStatus').textContent='Configuración guardada · pulsa ACTUALIZAR para recalcular';
}
function onLiveTick(tick){
 if(!state.selected||tick.symbol!==state.selected||!state.rawCandles.length)return;
 const price=Number(tick.quote),epoch=Number(tick.epoch);if(!Number.isFinite(price)||!Number.isFinite(epoch))return;
 const minute=Math.floor(epoch/60)*60;
 // Agrupa ticks entre frames: como máximo una actualización visual por frame.
 const pending=state.pendingLiveTick;
 if(pending&&pending.symbol===tick.symbol&&pending.minute===minute){
  pending.high=Math.max(pending.high,price);pending.low=Math.min(pending.low,price);
  pending.quote=price;pending.epoch=epoch;
 }else state.pendingLiveTick={symbol:tick.symbol,minute,quote:price,high:price,low:price,epoch};
 if(state.liveFrame)return;
 state.liveFrame=requestAnimationFrame(()=>{
  state.liveFrame=0;
  const p=state.pendingLiveTick;state.pendingLiveTick=null;
  if(!p||p.symbol!==state.selected||!state.rawCandles.length)return;
  let last=state.rawCandles[state.rawCandles.length-1];
  if(p.minute>last.time){
   state.rawCandles.push({time:p.minute,open:p.quote,high:p.high,low:p.low,close:p.quote});
   if(state.rawCandles.length>HISTORY_CANDLES)state.rawCandles.shift();
  }else if(p.minute===last.time){
   last.high=Math.max(last.high,p.high);last.low=Math.min(last.low,p.low);last.close=p.quote;
  }
  const tfSeconds=state.tf*60,bucket=Math.floor(p.epoch/tfSeconds)*tfSeconds;
  const group=[];for(let i=state.rawCandles.length-1;i>=0;i--){const bar=state.rawCandles[i];if(Math.floor(bar.time/tfSeconds)*tfSeconds!==bucket)break;group.push(bar);}
  if(group.length&&state.series.candle){
   let high=p.high,low=p.low;for(const bar of group){if(bar.high>high)high=bar.high;if(bar.low<low)low=bar.low;}
   state.series.candle.update({time:bucket,open:group[group.length-1].open,high,low,close:p.quote});
  }
  const liveChartCandles=aggregate(state.rawCandles,state.tf);const liveClose=liveChartCandles.map(x=>x.close),liveRsi=rsi(liveClose),liveE20=ema(liveClose,20),liveE50=ema(liveClose,50);const liveRsiValue=liveRsi.at(-1);if(state.series.rsi)state.series.rsi.setData(liveRsi.map((v,i)=>v==null?null:{time:liveChartCandles[i].time,value:v}).filter(Boolean));if(state.series.ema20)state.series.ema20.setData(liveE20.map((v,i)=>({time:liveChartCandles[i].time,value:v})));if(state.series.ema50)state.series.ema50.setData(liveE50.map((v,i)=>({time:liveChartCandles[i].time,value:v})));if(Number.isFinite(liveRsiValue)){if($('rsiValue'))$('rsiValue').textContent=fmt(liveRsiValue);if($('rsiLegend'))$('rsiLegend').textContent='Valor actual en formación: '+fmt(liveRsiValue);}
  // Los ticks actualizan la vela y el RSI; no recalculan OB, señales ni backtesting automáticamente.
 });
}
function subscribeLive(){if(state.liveSub){try{state.ws.send(JSON.stringify({forget:state.liveSub}));}catch{}}request({ticks:state.selected,subscribe:1}).then(r=>{state.liveSub=r.subscription?.id||null;}).catch(()=>{});}
function selectSymbol(symbol){if(!state.symbols.some(s=>s.symbol===symbol))return;state.selected=symbol;savePersistentState();state.forceFitNext=true;$('symbolSelect').value=symbol;document.querySelectorAll('.instrument-chip').forEach(b=>b.classList.toggle('selected',b.dataset.symbol===symbol));analyze();subscribeLive();}
function bindPivotControls(){
 const root=$('pivotTfControls');if(!root)return;
 try{const saved=JSON.parse(localStorage.getItem('botder-pivot-tfs')||'null');if(saved&&typeof saved==='object'){for(const mins of [1,2,3,4,5,10,30,60])if(typeof saved[mins]==='boolean')state.pivotTfEnabled[mins]=saved[mins];}}catch{}
 const sync=()=>{root.querySelectorAll('button[data-pivot-tf]').forEach(button=>{const mins=Number(button.dataset.pivotTf),enabled=!!state.pivotTfEnabled[mins];button.classList.toggle('active',enabled);button.setAttribute('aria-pressed',String(enabled));});};
 sync();
 root.addEventListener('click',event=>{const button=event.target.closest('button[data-pivot-tf]');if(!button)return;const mins=Number(button.dataset.pivotTf);state.pivotTfEnabled[mins]=!state.pivotTfEnabled[mins];try{localStorage.setItem('botder-pivot-tfs',JSON.stringify(state.pivotTfEnabled));}catch{}sync();drawPivotLines();scheduleRecalculation();});
}
function bindOBControls(){
 const obRoot=$('obTfControls'),previousRoot=$('obPreviousTfControls'),previousToggle=$('obPreviousEnabled'),pivotRoot=$('pivotStructureTfControls'),tpRoot=$('tpTfControls'),slRoot=$('slTfControls');
 const obTfs=[1,2,3,5,10,15,30,60];
 try{const saved=JSON.parse(localStorage.getItem('botder-ob-settings')||'null');if(saved&&typeof saved==='object'){if(obTfs.includes(Number(saved.obPrimaryTf)))state.obPrimaryTf=Number(saved.obPrimaryTf);if(obTfs.includes(Number(saved.obPreviousTf)))state.obPreviousTf=Number(saved.obPreviousTf);if(typeof saved.obPreviousEnabled==='boolean')state.obPreviousEnabled=saved.obPreviousEnabled;if([1,2,3,4,5].includes(Number(saved.obTf)))state.obTf=Number(saved.obTf);if([1,2,3,4,5,10,30,60].includes(Number(saved.pivotTf)))state.pivotTf=Number(saved.pivotTf);if(Array.isArray(saved.tpTfs))state.tpTfs=saved.tpTfs.map(Number).filter(v=>[1,3,5,10,15,30].includes(v));if(Array.isArray(saved.slTfs))state.slTfs=saved.slTfs.map(Number).filter(v=>[1,3,5,10,15,30].includes(v));}}catch{}
 if(!state.tpTfs.length)state.tpTfs=[1,3,5,10];if(!state.slTfs.length)state.slTfs=[1,3,5,10];
 const save=()=>{try{localStorage.setItem('botder-ob-settings',JSON.stringify({obTf:state.obTf,obPrimaryTf:state.obPrimaryTf,obPreviousTf:state.obPreviousTf,obPreviousEnabled:state.obPreviousEnabled,pivotTf:state.pivotTf,tpTfs:state.tpTfs,slTfs:state.slTfs}));}catch{}};
 const sync=(root,attr,value)=>{if(!root)return;root.querySelectorAll('button['+attr+']').forEach(b=>{const active=Number(b.getAttribute(attr))===value;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});};
 const syncMulti=(root,attr,values)=>{if(!root)return;root.querySelectorAll('button['+attr+']').forEach(b=>{const active=values.includes(Number(b.getAttribute(attr)));b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});};
 if(obRoot){sync(obRoot,'data-ob-primary-tf',state.obPrimaryTf);obRoot.addEventListener('click',e=>{const b=e.target.closest('button[data-ob-primary-tf]');if(!b)return;state.obPrimaryTf=Number(b.dataset.obPrimaryTf);sync(obRoot,'data-ob-primary-tf',state.obPrimaryTf);save();scheduleRecalculation();});}
 if(previousRoot){sync(previousRoot,'data-ob-previous-tf',state.obPreviousTf);previousRoot.addEventListener('click',e=>{const b=e.target.closest('button[data-ob-previous-tf]');if(!b)return;state.obPreviousTf=Number(b.dataset.obPreviousTf);sync(previousRoot,'data-ob-previous-tf',state.obPreviousTf);save();scheduleRecalculation();});}
 if(previousToggle){previousToggle.checked=state.obPreviousEnabled;previousToggle.addEventListener('change',()=>{state.obPreviousEnabled=previousToggle.checked;save();scheduleRecalculation();});}
 if(pivotRoot){
  // El selector de esta sección controla los pivotes visibles: deja activa únicamente la temporalidad elegida.
  const applyPivotStructureTf=()=>{
   for(const mins of [1,2,3,4,5,10,30,60])state.pivotTfEnabled[mins]=mins===state.pivotTf;
   try{localStorage.setItem('botder-pivot-tfs',JSON.stringify(state.pivotTfEnabled));}catch{}
   const visibleRoot=$('pivotTfControls');
   if(visibleRoot)visibleRoot.querySelectorAll('button[data-pivot-tf]').forEach(button=>{
    const active=!!state.pivotTfEnabled[Number(button.dataset.pivotTf)];
    button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));
   });
  };
  applyPivotStructureTf();
  sync(pivotRoot,'data-pivot-structure-tf',state.pivotTf);
  pivotRoot.addEventListener('click',e=>{
   const b=e.target.closest('button[data-pivot-structure-tf]');if(!b)return;
   state.pivotTf=Number(b.dataset.pivotStructureTf);
   applyPivotStructureTf();save();
   sync(pivotRoot,'data-pivot-structure-tf',state.pivotTf);
   scheduleRecalculation();
  });
 }
 const bindMulti=(root,attr,key)=>{if(!root)return;syncMulti(root,attr,state[key]);root.addEventListener('click',e=>{const b=e.target.closest('button['+attr+']');if(!b)return;const tf=Number(b.getAttribute(attr)),set=new Set(state[key]);if(set.has(tf)){if(set.size===1)return;set.delete(tf);}else set.add(tf);state[key]=[1,3,5,10,15,30].filter(v=>set.has(v));save();syncMulti(root,attr,state[key]);scheduleRecalculation();});};
 bindMulti(tpRoot,'data-tp-tf','tpTfs');bindMulti(slRoot,'data-sl-tf','slTfs');
}

function bind(){
 bindPivotControls();bindOBControls();
 $('instrumentList').addEventListener('click',e=>{const b=e.target.closest('button[data-symbol]');if(b)selectSymbol(b.dataset.symbol);});
 $('symbolSelect').addEventListener('change',e=>selectSymbol(e.target.value));
 $('timeframes').addEventListener('click',async e=>{const b=e.target.closest('button[data-tf]');if(!b)return;state.tf=+b.dataset.tf;state.forceFitNext=true;document.querySelectorAll('#timeframes button').forEach(x=>x.classList.toggle('active',x===b));scheduleRecalculation();});
 $('refreshBtn').addEventListener('click',async()=>{state.rawBySymbol.delete(state.selected);await analyze();});$('runBacktest').addEventListener('click',async()=>{runUniverseBacktest(true).catch(e=>{$('backtestInfo').textContent='Error al actualizar: '+e.message;});});
}
async function start(){restorePersistentState();bind();try{await loadSymbols();if(state.savedSelected&&state.symbols.some(s=>s.symbol===state.savedSelected)){state.selected=state.savedSelected;$('symbolSelect').value=state.selected;document.querySelectorAll('.instrument-chip').forEach(b=>b.classList.toggle('selected',b.dataset.symbol===state.selected));}setConnection(false,'Catálogo recibido · cargando velas…');$('dataStatus').textContent='Instrumentos listos · cargando gráfico principal…';await analyze();if(!state.rawCandles.length||!state.main)throw new Error($('dataStatus').textContent||'Deriv no entregó velas para dibujar');setConnection(true,'Deriv conectada · datos recibidos');subscribeLive();$('backtestInfo').textContent='Backtesting detenido automáticamente · pulsa ACTUALIZAR BACKTEST cuando quieras recalcular el historial.';}catch(e){setConnection(false,'Sin datos de Deriv');$('dataStatus').textContent='No se pudo iniciar: '+e.message;$('signalDetails').textContent=e.message;}}
start();
})();