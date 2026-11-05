/* BOTDER · motor de análisis y backtesting. Sin ejecución de órdenes. */
(() => {
'use strict';
const HISTORY_CANDLES = 1440;
const REQUEST_TIMEOUT_MS = 45000;
const API_URL = 'wss://api.derivws.com/trading/v1/options/ws/public';
const $ = id => document.getElementById(id);
const state = { ws:null, req:0, pending:new Map(), symbols:[], selected:null, tf:1, candles:[], rawCandles:[], rawBySymbol:new Map(), marketBacktests:[], trades:[], liveSub:null, main:null, rsi:null, markerPlugin:null, overlayResizeObserver:null, overlayUpdate:null, overlayRangeHandler:null, pivotLines:[], chartKey:null, series:{}, busy:false, analyzeQueued:false, forceFitNext:true, lastRecalcBucket:null };
const CANDIDATES = [
 ['1HZ10V','Volatility 10 (1s)'],['1HZ15V','Volatility 15 (1s)'],['1HZ25V','Volatility 25 (1s)'],['1HZ30V','Volatility 30 (1s)'],['1HZ50V','Volatility 50 (1s)'],['1HZ75V','Volatility 75 (1s)'],['1HZ90V','Volatility 90 (1s)'],['1HZ100V','Volatility 100 (1s)'],['1HZ150V','Volatility 150 (1s)'],['1HZ250V','Volatility 250 (1s)'],
 ['R_10','Volatility 10'],['R_25','Volatility 25'],['R_50','Volatility 50'],['R_75','Volatility 75'],['R_100','Volatility 100'],
 ['stpRNG','Step Index'],['CRASH300','Crash 300'],['BOOM300','Boom 300'],['CRASH500','Crash 500'],['BOOM500','Boom 500'],['CRASH1000','Crash 1000'],['BOOM1000','Boom 1000'],['JD10','Jump 10'],['JD25','Jump 25'],['JD50','Jump 50']
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
 // La API nueva de Deriv renombró symbol/display_name a underlying_symbol/underlying_symbol_name.
 const codeOf=s=>s.underlying_symbol||s.symbol||'';
 const nameOf=s=>s.underlying_symbol_name||s.display_name||'';
 const byCode=new Map(all.map(s=>[codeOf(s),s]));
 const chosen=CANDIDATES.map(([code,label])=>{const s=byCode.get(code);return s?{symbol:codeOf(s),name:nameOf(s)||label,market:s.market,submarket:s.submarket}:null;}).filter(Boolean);
 // Completa con los sintéticos activos reconocidos por su nombre en la API nueva o antigua.
 const extras=all.filter(s=>/volatility|crash|boom|step index|jump/i.test(nameOf(s)))
   .filter(s=>!chosen.some(x=>x.symbol===codeOf(s)))
   .sort((a,b)=>{
     const an=nameOf(a),bn=nameOf(b);
     const rank=n=>/step index/i.test(n)?0:/crash 300|boom 300/i.test(n)?1:/volatility/i.test(n)?2:/crash|boom/i.test(n)?3:4;
     const num=n=>parseInt((n.match(/\d+/)||['9999'])[0],10);return rank(an)-rank(bn)||num(an)-num(bn)||an.localeCompare(bn);
   }).map(s=>({symbol:codeOf(s),name:nameOf(s)||codeOf(s),market:s.market,submarket:s.submarket}));
 // Prioriza Step Index y los Crash/Boom con el número más bajo disponible.
 const ordered=[...chosen].sort((a,b)=>{
   const rank=n=>/step index/i.test(n)?0:/crash 300|boom 300/i.test(n)?1:/volatility/i.test(n)?2:/crash|boom/i.test(n)?3:4;
   return rank(a.name)-rank(b.name);
 });
 state.symbols=[...ordered,...extras].slice(0,25);
 if(!state.symbols.length){
  const sample=all.slice(0,12).map(x=>(nameOf(x)||'sin nombre')+' ['+(codeOf(x)||'?')+']').join(', ');
  throw new Error('Deriv respondió '+all.length+' símbolos, pero ninguno coincidió con los filtros. Muestra: '+(sample||'catálogo vacío'));
 }
 $('instrumentCount').textContent=state.symbols.length+' / 25 instrumentos activos';
 state.selected=state.symbols[0].symbol;
 $('instrumentList').innerHTML=state.symbols.map(s=>'<button type="button" class="instrument-chip'+(s.symbol===state.selected?' selected':'')+'" data-symbol="'+esc(s.symbol)+'">'+esc(s.name)+'</button>').join('');
 $('symbolSelect').innerHTML=state.symbols.map(s=>'<option value="'+esc(s.symbol)+'">'+esc(s.name)+'</option>').join('');
}

function esc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
async function getCandles(symbol,preferredCount=HISTORY_CANDLES){
 let lastError=null;const counts=[...new Set([Math.min(preferredCount,1440),HISTORY_CANDLES])];
 for(const count of counts){
  try{const r=await request({ticks_history:symbol,adjust_start_time:1,count,end:'latest',granularity:60,style:'candles'});const candles=(r.candles||[]).map(c=>({time:Number(c.epoch),open:+c.open,high:+c.high,low:+c.low,close:+c.close})).filter(c=>Number.isFinite(c.time)&&Number.isFinite(c.open)&&Number.isFinite(c.high)&&Number.isFinite(c.low)&&Number.isFinite(c.close));if(candles.length)return candles;lastError=new Error('Deriv devolvió 0 velas para '+symbol);}catch(e){lastError=e;}
 }
 throw new Error('No se pudo descargar el historial de '+symbol+': '+(lastError?.message||'sin datos'));
}
function aggregate(candles,mins){if(mins===1)return candles;const groups=new Map();for(const candle of candles){const bucket=Math.floor(candle.time/(mins*60))*(mins*60);let g=groups.get(bucket);if(!g){g={time:bucket,open:candle.open,high:candle.high,low:candle.low,close:candle.close,count:0};groups.set(bucket,g);}g.high=Math.max(g.high,candle.high);g.low=Math.min(g.low,candle.low);g.close=candle.close;g.count++;}const lastBucket=candles.length?Math.floor(candles.at(-1).time/(mins*60))*(mins*60):null;return [...groups.values()].filter(g=>g.count===mins||g.time===lastBucket).map(({count,...bar})=>bar).sort((a,b)=>a.time-b.time);}
function ema(values,period){const out=Array(values.length).fill(null),k=2/(period+1);let prev=null;values.forEach((v,i)=>{prev=prev===null?v:v*k+prev*(1-k);out[i]=prev;});return out;}
function rsi(values,period=14){const out=Array(values.length).fill(null);let gain=0,loss=0;for(let i=1;i<values.length;i++){const d=values[i]-values[i-1];const g=Math.max(d,0),l=Math.max(-d,0);if(i<=period){gain+=g;loss+=l;if(i===period){gain/=period;loss/=period;out[i]=loss===0?100:100-100/(1+gain/loss);}}else{gain=(gain*(period-1)+g)/period;loss=(loss*(period-1)+l)/period;out[i]=loss===0?100:100-100/(1+gain/loss);}}return out;}
function pivots(c,span=3,candleSeconds=600){const highs=[],lows=[];for(let i=span;i<c.length-span;i++){let hi=true,lo=true;for(let j=1;j<=span;j++){if(c[i].high<=c[i-j].high||c[i].high<=c[i+j].high)hi=false;if(c[i].low>=c[i-j].low||c[i].low>=c[i+j].low)lo=false;}if(hi)highs.push({index:i,time:c[i].time,confirmedTime:c[i+span].time+candleSeconds,price:c[i].high});if(lo)lows.push({index:i,time:c[i].time,confirmedTime:c[i+span].time+candleSeconds,price:c[i].low});}const sample=c.slice(-30),avgRange=sample.length?sample.reduce((sum,v)=>sum+(v.high-v.low),0)/sample.length:0,tolerance=avgRange*.45;const merge=items=>{const kept=[];for(const p of items){const near=kept.findIndex(q=>Math.abs(q.price-p.price)<=tolerance);if(near<0)kept.push(p);else if(p.confirmedTime>kept[near].confirmedTime)kept[near]=p;}return kept.sort((a,b)=>a.time-b.time);};return{highs:merge(highs),lows:merge(lows)};}
function buildSetups(c,liquidityCandles=c,pivotCandles=liquidityCandles){
 const close=c.map(x=>x.close),e9=ema(close,9),e21=ema(close,21),e50=ema(close,50),rv=rsi(close),pv=pivots(pivotCandles,3,600);
 const setups=[],usedOBs=new Set();
 for(let i=55;i<c.length-1;i++){
  const x=c[i],prev=c[i-1],body=Math.abs(x.close-x.open),avg=c.slice(i-8,i).reduce((s,v)=>s+Math.abs(v.close-v.open),0)/8;
  const bull=e9[i-1]<=e21[i-1]&&e9[i]>e21[i]&&e21[i]>e50[i],bear=e9[i-1]>=e21[i-1]&&e9[i]<e21[i]&&e21[i]<e50[i];
  const buyRsi=rv[i]>=50&&rv[i]<=60&&rv[i]>rv[i-1],sellRsi=rv[i]<=55&&rv[i]>=40&&rv[i]<rv[i-1];
  const strongBull=x.close>x.open&&body>avg*1.25, strongBear=x.close<x.open&&body>avg*1.25;
  if(bull&&buyRsi&&strongBull){
   const ob=findOBAtTime(liquidityCandles,x.time,'buy');if(!ob)continue;
   const targets=pv.highs.filter(p=>p.confirmedTime<=x.time&&p.price>ob.entry).sort((a,b)=>a.price-b.price);
   if(!targets.length)continue;
   const sl=ob.low-(ob.high-ob.low)*.12;
   const obKey='BUY:'+ob.time;if(usedOBs.has(obKey))continue;usedOBs.add(obKey);
   setups.push({side:'BUY',index:i,time:x.time,entry:ob.entry,sl,tp1:targets[0].price,tp2:(targets[1]||targets[0]).price,ob, rsi:rv[i],state:'PREPARADA'});
  }
  if(bear&&sellRsi&&strongBear){
   const ob=findOBAtTime(liquidityCandles,x.time,'sell');if(!ob)continue;
   const targets=pv.lows.filter(p=>p.confirmedTime<=x.time&&p.price<ob.entry).sort((a,b)=>b.price-a.price);
   if(!targets.length)continue;
   const sl=ob.high+(ob.high-ob.low)*.12;
   const obKey='SELL:'+ob.time;if(usedOBs.has(obKey))continue;usedOBs.add(obKey);
   setups.push({side:'SELL',index:i,time:x.time,entry:ob.entry,sl,tp1:targets[0].price,tp2:(targets[1]||targets[0]).price,ob,rsi:rv[i],state:'PREPARADA'});
  }
 }
 return{setups,e9,e21,e50,rv,pv};
}
function findOBAtTime(c,time,side){const completed=c.filter(bar=>bar.time+300<=time);return findOB(completed,completed.length,side);}
function findOB(c,i,side){for(let j=i-1;j>=Math.max(0,i-9);j--){const q=c[j],opposite=side==='BUY'?q.close<q.open:q.close>q.open;if(opposite){const entry=(q.high+q.low)/2;return{time:q.time,high:q.high,low:q.low,entry};}}return null;}
function simulate(c,setups){
 const trades=[];for(const s of setups){let entered=false,result='PENDIENTE',entryIndex=-1,exitTime=null;for(let j=s.index+1;j<c.length;j++){const k=c[j];if(!entered){const entryHit=k.low<=s.entry&&k.high>=s.entry;if(!entryHit){if((s.side==='BUY'&&k.low<s.sl)||(s.side==='SELL'&&k.high>s.sl)){result='CANCELADA';exitTime=k.time;break;}if(j-s.index>=5){result='CANCELADA';exitTime=k.time;break;}continue;}entered=true;entryIndex=j;}const slHit=s.side==='BUY'?k.low<=s.sl:k.high>=s.sl;const tp1Hit=s.side==='BUY'?k.high>=s.tp1:k.low<=s.tp1;const tp2Hit=s.side==='BUY'?k.high>=s.tp2:k.low<=s.tp2;if(slHit){result='PERDIDA';exitTime=k.time;break;}if(tp1Hit||tp2Hit){result='GANADA';exitTime=k.time;break;}}trades.push({...s,result,entryIndex,exitTime});}return trades;}
function draw(c,calc,trades){
 const chartKey=state.selected+'|'+state.tf;const priorRange=state.main?state.main.timeScale().getVisibleLogicalRange():null;const preserveRange=!!priorRange&&!state.forceFitNext;
 if(!window.LightweightCharts){$('mainChart').innerHTML='<div class="chart-placeholder">No se pudo cargar el motor del gráfico. Comprueba tu conexión e intenta actualizar.</div>';throw new Error('No cargó Lightweight Charts desde el CDN');}
 if(state.overlayResizeObserver){state.overlayResizeObserver.disconnect();state.overlayResizeObserver=null;}
 if(state.main&&state.rsi&&state.chartKey===chartKey){
  const lineData=values=>values.map((v,i)=>v==null?null:{time:c[i].time,value:v}).filter(Boolean);
  state.series.candle.setData(c);state.series.ema9.setData(lineData(calc.e9));state.series.ema21.setData(lineData(calc.e21));state.series.ema50.setData(lineData(calc.e50));state.series.rsi.setData(lineData(calc.rv));
  drawPivotLines(calc.pv);const markers=[];trades.forEach(t=>{markers.push({time:t.ob.time,position:t.side==='BUY'?'belowBar':'aboveBar',color:t.side==='BUY'?'#168f76':'#b43c4b',shape:'square',text:t.side==='BUY'?'OB ALC':'OB BAJ'});markers.push({time:t.time,position:t.side==='BUY'?'belowBar':'aboveBar',color:t.side==='BUY'?'#20d69a':'#ff5968',shape:t.side==='BUY'?'arrowUp':'arrowDown',text:t.side==='BUY'?'COMPRA':'VENTA'});});if(state.markerPlugin)state.markerPlugin.setMarkers(markers.sort((a,b)=>a.time-b.time));
  const latest=trades.slice(-1)[0];drawOverlays(latest,c,$('mainChart'));
  if(state.forceFitNext){const visibleFrom=Math.max(0,c.length-120);const visibleRange={from:visibleFrom,to:c.length+3};state.main.timeScale().setVisibleLogicalRange(visibleRange);state.rsi.timeScale().setVisibleLogicalRange(visibleRange);}else if(priorRange){state.main.timeScale().setVisibleLogicalRange(priorRange);state.rsi.timeScale().setVisibleLogicalRange(priorRange);}state.forceFitNext=false;return;
 }
 if(state.main){state.main.remove();if(state.rsi)state.rsi.remove();}state.overlayUpdate=null;state.overlayRangeHandler=null;
 const L=LightweightCharts,main=$('mainChart');main.innerHTML='';
 state.chartKey=chartKey;state.main=L.createChart(main,{autoSize:true,layout:{background:{type:'solid',color:'#0b121e'},textColor:'#9aaac0',fontSize:8},grid:{vertLines:{color:'#172235'},horzLines:{color:'#172235'}},rightPriceScale:{borderColor:'#28364a'},timeScale:{borderColor:'#28364a',timeVisible:true,secondsVisible:false},handleScroll:{mouseWheel:true,pressedMouseMove:true,horzTouchDrag:true,vertTouchDrag:true},handleScale:{mouseWheel:true,pinch:true,axisPressedMouseMove:true}});
 const candle=state.main.addSeries(L.CandlestickSeries,{upColor:'#19c99a',downColor:'#ff5968',borderVisible:false,wickUpColor:'#19c99a',wickDownColor:'#ff5968'});state.series.candle=candle;
 candle.setData(c);
 const addLine=(values,color)=>{const s=state.main.addSeries(L.LineSeries,{color,lineWidth:2,priceLineVisible:false,lastValueVisible:false});s.setData(values.map((v,i)=>v==null?null:{time:c[i].time,value:v}).filter(Boolean));return s;};
 state.series.ema9=addLine(calc.e9,'#36b9f6');state.series.ema21=addLine(calc.e21,'#f5a33b');state.series.ema50=addLine(calc.e50,'#a36aff');
 drawPivotLines(calc.pv);const markers=[];
 trades.forEach(t=>{
  markers.push({time:t.ob.time,position:t.side==='BUY'?'belowBar':'aboveBar',color:t.side==='BUY'?'#168f76':'#b43c4b',shape:'square',text:t.side==='BUY'?'OB A':'OB B'});
  markers.push({time:t.time,position:t.side==='BUY'?'belowBar':'aboveBar',color:t.side==='BUY'?'#20d69a':'#ff5968',shape:t.side==='BUY'?'arrowUp':'arrowDown',text:t.side==='BUY'?'COMPRA':'VENTA'});
 });
 if(typeof L.createSeriesMarkers==='function'){state.markerPlugin=L.createSeriesMarkers(candle,markers.sort((a,b)=>a.time-b.time));}else{console.warn('La versión de Lightweight Charts no incluye createSeriesMarkers');}
 const latest=trades.slice(-1)[0];
 drawOverlays(latest,c,main);
 const rsiEl=$('rsiChart');rsiEl.innerHTML='';
 state.rsi=L.createChart(rsiEl,{autoSize:true,layout:{background:{type:'solid',color:'#0b121e'},textColor:'#8b9bb0',fontSize:10},grid:{vertLines:{color:'#172235'},horzLines:{color:'#172235'}},rightPriceScale:{borderColor:'#28364a'},timeScale:{visible:false},handleScroll:{mouseWheel:true,pressedMouseMove:true,horzTouchDrag:true},handleScale:{mouseWheel:true,pinch:true}});
 const rs=state.rsi.addSeries(L.LineSeries,{color:'#a36aff',lineWidth:2,priceLineVisible:false,lastValueVisible:true});state.series.rsi=rs;rs.setData(calc.rv.map((v,i)=>v==null?null:{time:c[i].time,value:v}).filter(Boolean));
 [30,50,70].forEach(v=>rs.createPriceLine({price:v,color:'#45536b',lineStyle:L.LineStyle.Dashed,lineWidth:1,axisLabelVisible:false,title:''}));
 if(preserveRange){state.main.timeScale().setVisibleLogicalRange(priorRange);state.rsi.timeScale().setVisibleLogicalRange(priorRange);}else{const visibleFrom=Math.max(0,c.length-120);const visibleRange={from:visibleFrom,to:c.length+3};state.main.timeScale().setVisibleLogicalRange(visibleRange);state.rsi.timeScale().setVisibleLogicalRange(visibleRange);}let syncingRange=false;state.main.timeScale().subscribeVisibleLogicalRangeChange(range=>{if(!range||syncingRange)return;syncingRange=true;state.rsi.timeScale().setVisibleLogicalRange(range);syncingRange=false;});state.rsi.timeScale().subscribeVisibleLogicalRangeChange(range=>{if(!range||syncingRange)return;syncingRange=true;state.main.timeScale().setVisibleLogicalRange(range);syncingRange=false;});state.forceFitNext=false;
}
function drawPivotLines(pv){
 if(!state.series.candle)return;
 for(const line of state.pivotLines){try{state.series.candle.removePriceLine(line);}catch{}}
 state.pivotLines=[];
 const add=(items,title,color)=>items.slice(-5).forEach(p=>{
  const line=state.series.candle.createPriceLine({price:p.price,color,lineWidth:1,lineStyle:2,axisLabelVisible:true,title});
  state.pivotLines.push(line);
 });
 add(pv.highs,'R','#ff6876');
 add(pv.lows,'P','#e8c34c');
}
function drawOverlays(t,c,host){
 if(state.overlayResizeObserver){state.overlayResizeObserver.disconnect();state.overlayResizeObserver=null;}
 const old=host.querySelector('.chart-overlay');if(old)old.remove();state.overlayUpdate=null;if(!t)return;
 const overlay=document.createElement('div');overlay.className='chart-overlay';host.appendChild(overlay);
 const zone=document.createElement('div');zone.className='ob-zone '+(t.side==='BUY'?'bull-zone':'bear-zone');zone.innerHTML='<b>'+(t.side==='BUY'?'OB ALCISTA':'OB BAJISTA')+'</b>';overlay.appendChild(zone);
 const levels=[
  {p:t.entry,label:'ENTRADA',cls:'entry-line',priority:0},
  {p:t.sl,label:'STOP LOSS',cls:'sl-line',priority:1},
  {p:t.tp1,label:'TP1 · OBJETIVO',cls:'tp-line',priority:2}
 ];
 if(Math.abs(t.tp2-t.tp1)>1e-10)levels.push({p:t.tp2,label:'TP2 · OBJETIVO',cls:'tp2-line',priority:3});
 const lineEls=levels.map(v=>{
  const el=document.createElement('div');el.className='level-line '+v.cls;
  const tag=document.createElement('span');tag.className='level-tag';tag.innerHTML='<b>'+v.label+'</b><strong>'+fmt(v.p)+'</strong>';el.appendChild(tag);
  overlay.appendChild(el);return{el,tag,...v};
 });
 const update=()=>{
  const width=host.clientWidth,xOb=state.main.timeScale().timeToCoordinate(t.ob.time),xSignal=state.main.timeScale().timeToCoordinate(t.time);
  const xStart=Math.max(0,Math.min(width-8,xSignal==null?width*.45:xSignal));
  const xZone=Math.max(0,Math.min(width-8,xOb==null?width*.35:xOb));
  const yHigh=state.main.priceScale('right').priceToCoordinate(t.ob.high),yLow=state.main.priceScale('right').priceToCoordinate(t.ob.low);
  if(yHigh!=null&&yLow!=null){zone.style.display='flex';zone.style.left=xZone+'px';zone.style.width=Math.max(30,width-xZone-4)+'px';zone.style.top=Math.min(yHigh,yLow)+'px';zone.style.height=Math.max(12,Math.abs(yLow-yHigh))+'px';}else zone.style.display='none';
  const positioned=[];
  lineEls.forEach(v=>{
   const y=state.main.priceScale('right').priceToCoordinate(v.p);
   if(y==null){v.el.style.display='none';return;}
   v.el.style.display='block';v.el.style.left=xStart+'px';v.el.style.width=Math.max(30,width-xStart-3)+'px';v.el.style.top=y+'px';
   positioned.push({tag:v.tag,y,priority:v.priority});
  });
  positioned.sort((a,b)=>a.y-b.y);
  let previous=-Infinity;
  positioned.forEach(item=>{
   const desired=Math.max(13,Math.min(host.clientHeight-13,item.y));
   const placed=Math.max(desired,previous+27);
   item.tag.style.top=Math.max(2,Math.min(host.clientHeight-27,placed-13))+'px';
   previous=placed;
  });
 };
 state.overlayUpdate=update;
 if(!state.overlayRangeHandler){state.overlayRangeHandler=()=>{if(state.overlayUpdate)state.overlayUpdate();};state.main.timeScale().subscribeVisibleLogicalRangeChange(state.overlayRangeHandler);}
 if(window.ResizeObserver){state.overlayResizeObserver=new ResizeObserver(update);state.overlayResizeObserver.observe(host);}
 requestAnimationFrame(update);
}
function fmt(n){return Number.isFinite(n)?Number(n).toFixed(2):'—';}
function showLatest(calc,trades,c){
 const last=c[c.length-1],t=trades.filter(x=>x.result==='PENDIENTE').slice(-1)[0],rv=calc.rv[calc.rv.length-1];
 const trend=calc.e9.at(-1)>calc.e21.at(-1)&&calc.e21.at(-1)>calc.e50.at(-1)?'ALCISTA':calc.e9.at(-1)<calc.e21.at(-1)&&calc.e21.at(-1)<calc.e50.at(-1)?'BAJISTA':'LATERAL';
 $('trendValue').textContent=trend;$('trendValue').style.color=trend==='BAJISTA'?'#ff6876':trend==='ALCISTA'?'#20d69a':'#d5b35b';
 $('signalValue').textContent=t?(t.side==='BUY'?'COMPRA':'VENTA'):'ESPERANDO';$('signalValue').style.color=t?(t.side==='BUY'?'#20d69a':'#ff6876'):'#aab8ca';
 $('entryValue').textContent=t?fmt(t.entry):'—';$('slValue').textContent=t?fmt(t.sl):'—';$('tp1Value').textContent=t?fmt(t.tp1):'—';$('tp2Value').textContent=t?fmt(t.tp2):'—';$('rsiValue').textContent=fmt(rv);
 const confirms=t&&((t.side==='BUY'&&t.rsi>=50&&t.rsi<=60)||(t.side==='SELL'&&t.rsi<=55&&t.rsi>=40));
 $('rsiConfirm').textContent=t?(confirms?'CONFIRMA '+(t.side==='BUY'?'COMPRA':'VENTA'):'NO CONFIRMA'):'Sin señal';$('rsiConfirm').style.color=confirms?'#20d69a':'#ff6876';
 $('signalState').textContent=t?(t.entryIndex>=0?'ACTIVA':'PREPARADA'):'ESPERANDO';$('signalDetails').textContent=t?(t.entryIndex>=0?'Operación ACTIVA. ':'')+(t.side==='BUY'?'OB alcista':'OB bajista')+' detectado. Entrada proyectada '+fmt(t.entry)+', SL '+fmt(t.sl)+', TP1 en pivote '+fmt(t.tp1)+' y TP2 '+fmt(t.tp2)+'.':'No hay una señal completa en la última vela. El motor sigue analizando.';
 $('rsiLegend').textContent='Valor actual: '+fmt(rv);
}
function renderHistory(trades){const rows=trades.slice(-150).reverse();$('historyCount').textContent=trades.length+' operaciones';$('historyBody').innerHTML=rows.length?rows.map(t=>'<tr><td>'+new Date(t.time*1000).toLocaleTimeString('es-PA',{hour:'2-digit',minute:'2-digit'})+'</td><td style="color:'+(t.side==='BUY'?'#20d69a':'#ff6876')+'">'+(t.side==='BUY'?'COMPRA':'VENTA')+'</td><td>'+fmt(t.entry)+'</td><td>'+fmt(t.sl)+'</td><td>'+fmt(t.tp1)+'</td><td>'+fmt(t.tp2)+'</td><td>'+t.result+'</td></tr>').join(''):'<tr><td colspan="7" class="empty-cell">No hay operaciones detectadas en este período.</td></tr>';const closed=trades.filter(t=>t.result==='GANADA'||t.result==='PERDIDA');$('wins').textContent=closed.filter(t=>t.result==='GANADA').length;$('losses').textContent=closed.filter(t=>t.result==='PERDIDA').length;$('pending').textContent=trades.filter(t=>t.result==='PENDIENTE').length;$('expired').textContent=trades.filter(t=>t.result==='CANCELADA').length;}
async function runUniverseBacktest(refresh=false){
 if(!state.rawCandles.length)$('dataStatus').textContent='Preparando análisis de 24 horas…';
 if(refresh){state.rawBySymbol.clear();state.downloadErrors=[];}else if(!state.downloadErrors)state.downloadErrors=[];
 let cursor=0,done=0;const workers=Array.from({length:Math.min(4,state.symbols.length)},async()=>{
  while(cursor<state.symbols.length){const item=state.symbols[cursor++];try{if(refresh||!state.rawBySymbol.has(item.symbol)||(state.rawBySymbol.get(item.symbol)||[]).length<HISTORY_CANDLES){const raw=await getCandles(item.symbol,1440);state.rawBySymbol.set(item.symbol,raw);}done++;$('backtestInfo').textContent='Descargando historial: '+done+' / '+state.symbols.length+' instrumentos…';}catch(e){state.rawBySymbol.set(item.symbol,[]);if(!state.downloadErrors)state.downloadErrors=[];state.downloadErrors.push(item.name+': '+e.message);if(!state.rawBySymbol.has(item.symbol))state.rawBySymbol.set(item.symbol,[]);done++;$('backtestInfo').textContent='Descargas '+done+' / '+state.symbols.length+' · falló '+item.name;}}
 });
 await Promise.all(workers);
 const allTrades=[],shortHistory=[];
 for(const item of state.symbols){const source=state.rawBySymbol.get(item.symbol)||[];if(!source.length)continue;const cutoff=Math.floor(Date.now()/1000)-86400;const raw=source.filter(v=>v.time>=cutoff);if(raw.length<HISTORY_CANDLES)shortHistory.push(item.name+' ('+raw.length+' velas/24h)');const candles=aggregate(raw,state.tf);if(candles.length<70)continue;const calc=buildSetups(candles,aggregate(raw,5),aggregate(raw,10)),trades=simulate(candles,calc.setups);allTrades.push(...trades.map(t=>({...t,symbol:item.symbol})));}
 state.marketBacktests=allTrades;
 const closed=allTrades.filter(t=>t.result==='GANADA'||t.result==='PERDIDA');
 $('wins').textContent=closed.filter(t=>t.result==='GANADA').length;$('losses').textContent=closed.filter(t=>t.result==='PERDIDA').length;
 $('pending').textContent=allTrades.filter(t=>t.result==='PENDIENTE').length;$('expired').textContent=allTrades.filter(t=>t.result==='CANCELADA').length;
 const failed=state.downloadErrors.length;$('backtestInfo').textContent='Universo: '+state.symbols.length+' instrumentos · M'+state.tf+' · período: últimas 24 horas · '+allTrades.length+' señales simuladas · '+failed+' descargas fallidas · '+shortHistory.length+' con historial parcial'+(failed?'. Errores: '+state.downloadErrors.slice(0,2).join(' | '):'')+(shortHistory.length?'. Parciales: '+shortHistory.slice(0,3).join(', '):'.');
}
async function analyze(){
 if(state.busy){state.analyzeQueued=true;return;}state.busy=true;$('dataStatus').textContent='Cargando gráfico…';
 try{const raw=state.rawBySymbol.get(state.selected)||await getCandles(state.selected,1440);if(!raw.length)throw new Error('No llegaron velas para '+state.selected);state.rawBySymbol.set(state.selected,raw);
 state.rawCandles=raw;state.lastRecalcBucket=Math.floor(raw.at(-1).time/(state.tf*60));const c=aggregate(raw,state.tf);state.candles=c;const calc=buildSetups(c,aggregate(raw,5),aggregate(raw,10));state.trades=simulate(c,calc.setups);
 draw(c,calc,state.trades);showLatest(calc,state.trades,c);renderHistory(state.trades);
 $('chartTitle').textContent=(state.symbols.find(s=>s.symbol===state.selected)?.name||state.selected)+' · M'+state.tf;
 $('chartSubtitle').textContent='Velas '+c.length+' · últimas 24 horas · señales proyectadas';
 $('chartRange').textContent='Últimas 24 horas · '+new Date(c[0].time*1000).toLocaleTimeString('es-PA')+' — '+new Date(c.at(-1).time*1000).toLocaleTimeString('es-PA');
 $('dataStatus').textContent='Datos actualizados · '+raw.length+' velas M1';
 }catch(e){$('dataStatus').textContent='ERROR DE DATOS: '+e.message;$('signalDetails').textContent='No se pudo cargar este instrumento. '+e.message;}finally{state.busy=false;if(state.analyzeQueued){state.analyzeQueued=false;Promise.resolve().then(analyze);}}
}
function onLiveTick(tick){
 if(!state.selected||tick.symbol!==state.selected||!state.rawCandles.length)return;
 const price=Number(tick.quote),epoch=Number(tick.epoch);if(!Number.isFinite(price)||!Number.isFinite(epoch))return;
 const minute=Math.floor(epoch/60)*60;let last=state.rawCandles[state.rawCandles.length-1];
 if(minute>last.time){state.rawCandles.push({time:minute,open:price,high:price,low:price,close:price});if(state.rawCandles.length>HISTORY_CANDLES)state.rawCandles.shift();}
 else if(minute===last.time){last.high=Math.max(last.high,price);last.low=Math.min(last.low,price);last.close=price;}
 const tfSeconds=state.tf*60,bucket=Math.floor(epoch/tfSeconds)*tfSeconds;
 const group=state.rawCandles.filter(x=>Math.floor(x.time/tfSeconds)*tfSeconds===bucket);
 if(group.length&&state.series.candle){state.series.candle.update({time:bucket,open:group[0].open,high:Math.max(...group.map(x=>x.high)),low:Math.min(...group.map(x=>x.low)),close:price});}
 const recalcBucket=Math.floor(epoch/tfSeconds);
 if(state.lastRecalcBucket!==null&&recalcBucket>state.lastRecalcBucket){state.lastRecalcBucket=recalcBucket;state.rawBySymbol.set(state.selected,state.rawCandles);analyze();}
}
function subscribeLive(){if(state.liveSub){try{state.ws.send(JSON.stringify({forget:state.liveSub}));}catch{}}request({ticks:state.selected,subscribe:1}).then(r=>{state.liveSub=r.subscription?.id||null;}).catch(()=>{});}
function selectSymbol(symbol){if(!state.symbols.some(s=>s.symbol===symbol))return;state.selected=symbol;state.forceFitNext=true;$('symbolSelect').value=symbol;document.querySelectorAll('.instrument-chip').forEach(b=>b.classList.toggle('selected',b.dataset.symbol===symbol));analyze();subscribeLive();}
function bind(){
 $('instrumentList').addEventListener('click',e=>{const b=e.target.closest('button[data-symbol]');if(b)selectSymbol(b.dataset.symbol);});
 $('symbolSelect').addEventListener('change',e=>selectSymbol(e.target.value));
 $('timeframes').addEventListener('click',async e=>{const b=e.target.closest('button[data-tf]');if(!b)return;state.tf=+b.dataset.tf;state.forceFitNext=true;document.querySelectorAll('#timeframes button').forEach(x=>x.classList.toggle('active',x===b));await analyze();});
 $('refreshBtn').addEventListener('click',async()=>{state.rawBySymbol.delete(state.selected);await analyze();runUniverseBacktest(true).catch(e=>{$('backtestInfo').textContent='Error al actualizar: '+e.message;});});$('runBacktest').addEventListener('click',async()=>{runUniverseBacktest(true).catch(e=>{$('backtestInfo').textContent='Error al actualizar: '+e.message;});});
}
async function start(){bind();try{await loadSymbols();setConnection(false,'Catálogo recibido · cargando velas…');$('dataStatus').textContent='Instrumentos listos · cargando gráfico principal…';await analyze();if(!state.rawCandles.length||!state.main)throw new Error($('dataStatus').textContent||'Deriv no entregó velas para dibujar');setConnection(true,'Deriv conectada · datos recibidos');subscribeLive();$('backtestInfo').textContent='Gráfico listo. Calculando las últimas 24 horas en segundo plano…';runUniverseBacktest(false).catch(e=>{$('backtestInfo').textContent='Error en análisis de 24 horas: '+e.message;});}catch(e){setConnection(false,'Sin datos de Deriv');$('dataStatus').textContent='No se pudo iniciar: '+e.message;$('signalDetails').textContent=e.message;}}
start();
})();