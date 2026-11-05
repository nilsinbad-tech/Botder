/* BOTDER · motor de análisis y backtesting. Sin ejecución de órdenes. */
(() => {
'use strict';
const APP_ID = '1089';
const API_URL = 'wss://ws.derivws.com/websockets/v3?app_id=' + APP_ID;
const $ = id => document.getElementById(id);
const state = { ws:null, req:0, pending:new Map(), symbols:[], selected:null, tf:1, candles:[], rawCandles:[], rawBySymbol:new Map(), marketBacktests:[], trades:[], liveSub:null, main:null, rsi:null, series:{}, busy:false, lastRecalcBucket:null };
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
  ws.onopen=()=>{clearTimeout(timer);setConnection(true,'Deriv conectada');resolve();};
  ws.onerror=()=>{clearTimeout(timer);setConnection(false,'Error de conexión');reject(new Error('No se pudo conectar a Deriv'));};
  ws.onclose=()=>{setConnection(false,'Deriv desconectada');for(const [,p] of state.pending)p.reject(new Error('Conexión cerrada'));state.pending.clear();};
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.req_id&&state.pending.has(m.req_id)){const p=state.pending.get(m.req_id);state.pending.delete(m.req_id);m.error?p.reject(new Error(m.error.message)):p.resolve(m);}if(m.msg_type==='tick'&&m.tick)onLiveTick(m.tick);};
 });
}
function request(payload){return new Promise((resolve,reject)=>{const id=++state.req;state.pending.set(id,{resolve,reject});state.ws.send(JSON.stringify({...payload,req_id:id}));setTimeout(()=>{if(state.pending.has(id)){state.pending.delete(id);reject(new Error('Deriv no respondió a tiempo'));}},20000);});}
async function loadSymbols(){
 await connect();const r=await request({active_symbols:'brief',product_type:'basic'});
 const all=r.active_symbols||[];const byCode=new Map(all.map(s=>[s.symbol,s]));
 const chosen=CANDIDATES.map(([code,label])=>{const s=byCode.get(code);return s?{symbol:s.symbol,name:s.display_name||label,market:s.market,submarket:s.submarket}:null;}).filter(Boolean);
 // Completa el universo con otros sintéticos activos si algún símbolo preferido no está disponible.
 const extras=all.filter(s=>/synthetic|derived/i.test((s.market||'')+' '+(s.submarket||'')) && /volatility|crash|boom|step|jump/i.test(s.display_name||''))
   .filter(s=>!chosen.some(x=>x.symbol===s.symbol))
   .sort((a,b)=>{
     const rank=n=>/step index/i.test(n)?0:/crash 300|boom 300/i.test(n)?1:/volatility/i.test(n)?2:/crash|boom/i.test(n)?3:4;
     const num=n=>parseInt((n.match(/\d+/)||['9999'])[0],10);return rank(a.display_name)-rank(b.display_name)||num(a.display_name)-num(b.display_name)||a.display_name.localeCompare(b.display_name);
   }).map(s=>({symbol:s.symbol,name:s.display_name,market:s.market,submarket:s.submarket}));
 // Prioriza Step Index y los Crash/Boom con el número más bajo disponible.
 const ordered=[...chosen].sort((a,b)=>{
   const rank=n=>/step index/i.test(n)?0:/crash 300|boom 300/i.test(n)?1:/volatility/i.test(n)?2:/crash|boom/i.test(n)?3:4;
   return rank(a.name)-rank(b.name);
 });
 state.symbols=[...ordered,...extras].slice(0,25);
 if(!state.symbols.length)throw new Error('Deriv no devolvió los símbolos priorizados. Revisa el catálogo disponible.');
 $('instrumentCount').textContent=state.symbols.length+' / 25 instrumentos activos';
 $('instrumentList').innerHTML=state.symbols.map(s=>'<span class="instrument-chip">'+esc(s.name)+'</span>').join('');
 $('symbolSelect').innerHTML=state.symbols.map(s=>'<option value="'+esc(s.symbol)+'">'+esc(s.name)+'</option>').join('');
 state.selected=state.symbols[0].symbol;
}
function esc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
async function getCandles(symbol){
 const r=await request({ticks_history:symbol,adjust_start_time:1,count:1440,end:'latest',granularity:60,style:'candles'});
 return (r.candles||[]).map(c=>({time:Number(c.epoch),open:+c.open,high:+c.high,low:+c.low,close:+c.close})).filter(c=>Number.isFinite(c.close));
}
function aggregate(candles,mins){if(mins===1)return candles;const out=[];for(let i=0;i<candles.length;i+=mins){const a=candles.slice(i,i+mins);if(a.length<mins)continue;out.push({time:a[0].time,open:a[0].open,high:Math.max(...a.map(x=>x.high)),low:Math.min(...a.map(x=>x.low)),close:a[a.length-1].close});}return out;}
function ema(values,period){const out=Array(values.length).fill(null),k=2/(period+1);let prev=null;values.forEach((v,i)=>{prev=prev===null?v:v*k+prev*(1-k);out[i]=prev;});return out;}
function rsi(values,period=14){const out=Array(values.length).fill(null);let gain=0,loss=0;for(let i=1;i<values.length;i++){const d=values[i]-values[i-1];const g=Math.max(d,0),l=Math.max(-d,0);if(i<=period){gain+=g;loss+=l;if(i===period){gain/=period;loss/=period;out[i]=loss===0?100:100-100/(1+gain/loss);}}else{gain=(gain*(period-1)+g)/period;loss=(loss*(period-1)+l)/period;out[i]=loss===0?100:100-100/(1+gain/loss);}}return out;}
function pivots(c,span=3){const highs=[],lows=[];for(let i=span;i<c.length-span;i++){let hi=true,lo=true;for(let j=1;j<=span;j++){if(c[i].high<=c[i-j].high||c[i].high<=c[i+j].high)hi=false;if(c[i].low>=c[i-j].low||c[i].low>=c[i+j].low)lo=false;}if(hi)highs.push({index:i,time:c[i].time,price:c[i].high});if(lo)lows.push({index:i,time:c[i].time,price:c[i].low});}return{highs,lows};}
function buildSetups(c){
 const close=c.map(x=>x.close),e9=ema(close,9),e21=ema(close,21),e50=ema(close,50),rv=rsi(close),pv=pivots(c);
 const setups=[];
 for(let i=55;i<c.length-5;i++){
  const x=c[i],prev=c[i-1],body=Math.abs(x.close-x.open),avg=c.slice(i-8,i).reduce((s,v)=>s+Math.abs(v.close-v.open),0)/8;
  const bull=e9[i]>e21[i]&&e21[i]>e50[i],bear=e9[i]<e21[i]&&e21[i]<e50[i];
  const buyRsi=rv[i]>=50&&rv[i]<=65&&rv[i]>rv[i-1],sellRsi=rv[i]<=55&&rv[i]>=35&&rv[i]<rv[i-1];
  const strongBull=x.close>x.open&&body>avg*1.25, strongBear=x.close<x.open&&body>avg*1.25;
  if(bull&&buyRsi&&strongBull){
   const ob=findOB(c,i,'buy');if(!ob)continue;
   const targets=pv.highs.filter(p=>p.index<i&&p.price>ob.entry).sort((a,b)=>a.price-b.price);
   if(targets.length<2)continue;
   const sl=ob.low-(ob.high-ob.low)*.12;if(targets[0].price-ob.entry<=(ob.entry-sl)*1.5)continue;
   setups.push({side:'BUY',index:i,time:x.time,entry:ob.entry,sl,tp1:targets[0].price,tp2:targets[1].price,ob, rsi:rv[i],state:'PREPARADA'});
  }
  if(bear&&sellRsi&&strongBear){
   const ob=findOB(c,i,'sell');if(!ob)continue;
   const targets=pv.lows.filter(p=>p.index<i&&p.price<ob.entry).sort((a,b)=>b.price-a.price);
   if(targets.length<2)continue;
   const sl=ob.high+(ob.high-ob.low)*.12;if(ob.entry-targets[0].price<=(sl-ob.entry)*1.5)continue;
   setups.push({side:'SELL',index:i,time:x.time,entry:ob.entry,sl,tp1:targets[0].price,tp2:targets[1].price,ob,rsi:rv[i],state:'PREPARADA'});
  }
 }
 return{setups,e9,e21,e50,rv,pv};
}
function findOB(c,i,side){for(let j=i-1;j>=Math.max(0,i-9);j--){const q=c[j],opposite=side==='BUY'?q.close<q.open:q.close>q.open;if(opposite){const entry=(q.high+q.low)/2;return{time:q.time,high:q.high,low:q.low,entry};}}return null;}
function simulate(c,setups){
 const trades=[];for(const s of setups){let entered=false,result='PENDIENTE',entryIndex=-1,exitTime=null;for(let j=s.index+1;j<c.length;j++){const k=c[j];if(!entered){if(k.low<=s.entry&&k.high>=s.entry){entered=true;entryIndex=j;}else if(s.side==='BUY'&&k.low<s.sl||s.side==='SELL'&&k.high>s.sl){result='CANCELADA';exitTime=k.time;break;}}else{const slHit=s.side==='BUY'?k.low<=s.sl:k.high>=s.sl;const tp2Hit=s.side==='BUY'?k.high>=s.tp2:k.low<=s.tp2;const tp1Hit=s.side==='BUY'?k.high>=s.tp1:k.low<=s.tp1;if(slHit){result='PERDIDA';exitTime=k.time;break;}if(tp2Hit){result='GANADA';exitTime=k.time;break;}if(tp1Hit){result='GANADA';exitTime=k.time;break;}}}trades.push({...s,result,entryIndex,exitTime});}return trades;}
function draw(c,calc,trades){
 if(!window.LightweightCharts){$('mainChart').innerHTML='<div class="chart-placeholder">No se pudo cargar el motor del gráfico.</div>';return;}
 if(state.main){state.main.remove();state.rsi.remove();}
 const L=LightweightCharts,main=$('mainChart');main.innerHTML='';
 state.main=L.createChart(main,{autoSize:true,layout:{background:{type:'solid',color:'#0b121e'},textColor:'#9aaac0',fontSize:11},grid:{vertLines:{color:'#172235'},horzLines:{color:'#172235'}},rightPriceScale:{borderColor:'#28364a'},timeScale:{borderColor:'#28364a',timeVisible:true,secondsVisible:false},handleScroll:{mouseWheel:true,pressedMouseMove:true,horzTouchDrag:true,vertTouchDrag:true},handleScale:{mouseWheel:true,pinch:true,axisPressedMouseMove:true}});
 const candle=state.main.addSeries(L.CandlestickSeries,{upColor:'#19c99a',downColor:'#ff5968',borderVisible:false,wickUpColor:'#19c99a',wickDownColor:'#ff5968'});state.series.candle=candle;
 candle.setData(c);
 const addLine=(values,color)=>{const s=state.main.addSeries(L.LineSeries,{color,lineWidth:2,priceLineVisible:false,lastValueVisible:false});s.setData(values.map((v,i)=>v==null?null:{time:c[i].time,value:v}).filter(Boolean));return s;};
 addLine(calc.e9,'#36b9f6');addLine(calc.e21,'#f5a33b');addLine(calc.e50,'#a36aff');
 const markers=[];
 trades.forEach(t=>{
  markers.push({time:t.ob.time,position:t.side==='BUY'?'belowBar':'aboveBar',color:t.side==='BUY'?'#168f76':'#b43c4b',shape:'square',text:t.side==='BUY'?'OB A':'OB B'});
  markers.push({time:t.time,position:t.side==='BUY'?'belowBar':'aboveBar',color:t.side==='BUY'?'#20d69a':'#ff5968',shape:t.side==='BUY'?'arrowUp':'arrowDown',text:(t.side==='BUY'?'COMPRA ':'VENTA ')+fmt(t.entry)});
 });
 candle.setMarkers(markers.sort((a,b)=>a.time-b.time));
 const latest=trades.filter(t=>t.state==='PREPARADA').slice(-1)[0];
 state.main.timeScale().fitContent();drawOverlays(latest,c,main);
 const rsiEl=$('rsiChart');rsiEl.innerHTML='';
 state.rsi=L.createChart(rsiEl,{autoSize:true,layout:{background:{type:'solid',color:'#0b121e'},textColor:'#8b9bb0',fontSize:10},grid:{vertLines:{color:'#172235'},horzLines:{color:'#172235'}},rightPriceScale:{borderColor:'#28364a'},timeScale:{visible:false},handleScroll:{mouseWheel:true,pressedMouseMove:true,horzTouchDrag:true},handleScale:{mouseWheel:true,pinch:true}});
 const rs=state.rsi.addSeries(L.LineSeries,{color:'#a36aff',lineWidth:2,priceLineVisible:false,lastValueVisible:true});rs.setData(calc.rv.map((v,i)=>v==null?null:{time:c[i].time,value:v}).filter(Boolean));
 [30,50,70].forEach(v=>rs.createPriceLine({price:v,color:'#45536b',lineStyle:L.LineStyle.Dashed,lineWidth:1,axisLabelVisible:false,title:''}));
 state.rsi.timeScale().fitContent();
}
function drawOverlays(t,c,host){
 const old=host.querySelector('.chart-overlay');if(old)old.remove();if(!t)return;
 const overlay=document.createElement('div');overlay.className='chart-overlay';host.appendChild(overlay);
 const zone=document.createElement('div');zone.className='ob-zone '+(t.side==='BUY'?'bull-zone':'bear-zone');zone.innerHTML='<b>'+(t.side==='BUY'?'OB ALCISTA':'OB BAJISTA')+'</b>';overlay.appendChild(zone);
 const levels=[
  {p:t.entry,label:(t.side==='BUY'?'COMPRA':'VENTA')+' '+fmt(t.entry),cls:'entry-line'},
  {p:t.sl,label:'SL '+fmt(t.sl),cls:'sl-line'},
  {p:t.tp1,label:'TP1 · PIVOTE '+fmt(t.tp1),cls:'tp-line'},
  {p:t.tp2,label:'TP2 · SOPORTE/RESISTENCIA '+fmt(t.tp2),cls:'tp-line'}
 ];
 const lineEls=levels.map(v=>{const el=document.createElement('div');el.className='level-line '+v.cls;el.innerHTML='<span>'+v.label+'</span>';overlay.appendChild(el);return{el,...v};});
 const update=()=>{
  const width=host.clientWidth,xOb=state.main.timeScale().timeToCoordinate(t.ob.time),xSignal=state.main.timeScale().timeToCoordinate(t.time);
  const xStart=Math.max(0,Math.min(width-8,xSignal==null?width*.55:xSignal));
  const xZone=Math.max(0,Math.min(width-8,xOb==null?width*.4:xOb));
  const yHigh=state.main.priceScale('right').priceToCoordinate(t.ob.high),yLow=state.main.priceScale('right').priceToCoordinate(t.ob.low);
  if(yHigh!=null&&yLow!=null){zone.style.display='block';zone.style.left=xZone+'px';zone.style.width=Math.max(24,width-xZone-3)+'px';zone.style.top=Math.min(yHigh,yLow)+'px';zone.style.height=Math.max(8,Math.abs(yLow-yHigh))+'px';}else zone.style.display='none';
  lineEls.forEach(v=>{const y=state.main.priceScale('right').priceToCoordinate(v.p);if(y==null){v.el.style.display='none';return;}v.el.style.display='block';v.el.style.left=xStart+'px';v.el.style.width=Math.max(25,width-xStart-2)+'px';v.el.style.top=y+'px';});
 };
 state.main.timeScale().subscribeVisibleLogicalRangeChange(update);
 if(window.ResizeObserver){const ro=new ResizeObserver(update);ro.observe(host);}
 requestAnimationFrame(update);
}
function fmt(n){return Number.isFinite(n)?Number(n).toFixed(2):'—';}
function showLatest(calc,trades,c){
 const last=c[c.length-1],t=trades.filter(x=>x.state==='PREPARADA').slice(-1)[0],rv=calc.rv[calc.rv.length-1];
 const trend=calc.e9.at(-1)>calc.e21.at(-1)&&calc.e21.at(-1)>calc.e50.at(-1)?'ALCISTA':calc.e9.at(-1)<calc.e21.at(-1)&&calc.e21.at(-1)<calc.e50.at(-1)?'BAJISTA':'LATERAL';
 $('trendValue').textContent=trend;$('trendValue').style.color=trend==='BAJISTA'?'#ff6876':trend==='ALCISTA'?'#20d69a':'#d5b35b';
 $('signalValue').textContent=t?(t.side==='BUY'?'COMPRA':'VENTA'):'ESPERANDO';$('signalValue').style.color=t?(t.side==='BUY'?'#20d69a':'#ff6876'):'#aab8ca';
 $('entryValue').textContent=t?fmt(t.entry):'—';$('slValue').textContent=t?fmt(t.sl):'—';$('tp1Value').textContent=t?fmt(t.tp1):'—';$('tp2Value').textContent=t?fmt(t.tp2):'—';$('rsiValue').textContent=fmt(rv);
 const confirms=t&&((t.side==='BUY'&&t.rsi>=50&&t.rsi<=65)||(t.side==='SELL'&&t.rsi<=55&&t.rsi>=35));
 $('rsiConfirm').textContent=t?(confirms?'CONFIRMA '+(t.side==='BUY'?'COMPRA':'VENTA'):'NO CONFIRMA'):'Sin señal';$('rsiConfirm').style.color=confirms?'#20d69a':'#ff6876';
 $('signalState').textContent=t?'PREPARADA':'ESPERANDO';$('signalDetails').textContent=t?(t.side==='BUY'?'OB alcista':'OB bajista')+' detectado. Entrada proyectada '+fmt(t.entry)+', SL '+fmt(t.sl)+', TP1 en pivote '+fmt(t.tp1)+' y TP2 '+fmt(t.tp2)+'.':'No hay una señal completa en la última vela. El motor sigue analizando.';
 $('rsiLegend').textContent='Valor actual: '+fmt(rv);
}
function renderHistory(trades){const rows=trades.slice(-150).reverse();$('historyCount').textContent=trades.length+' operaciones';$('historyBody').innerHTML=rows.length?rows.map(t=>'<tr><td>'+new Date(t.time*1000).toLocaleTimeString('es-PA',{hour:'2-digit',minute:'2-digit'})+'</td><td style="color:'+(t.side==='BUY'?'#20d69a':'#ff6876')+'">'+(t.side==='BUY'?'COMPRA':'VENTA')+'</td><td>'+fmt(t.entry)+'</td><td>'+fmt(t.sl)+'</td><td>'+fmt(t.tp1)+'</td><td>'+fmt(t.tp2)+'</td><td>'+t.result+'</td></tr>').join(''):'<tr><td colspan="7" class="empty-cell">No hay operaciones detectadas en este período.</td></tr>';const closed=trades.filter(t=>t.result==='GANADA'||t.result==='PERDIDA');$('wins').textContent=closed.filter(t=>t.result==='GANADA').length;$('losses').textContent=closed.filter(t=>t.result==='PERDIDA').length;$('pending').textContent=trades.filter(t=>t.result==='PENDIENTE').length;$('expired').textContent=trades.filter(t=>t.result==='CANCELADA').length;}
async function runUniverseBacktest(refresh=false){
 $('dataStatus').textContent='Backtesting '+state.symbols.length+' instrumentos…';
 if(refresh)state.rawBySymbol.clear();
 let cursor=0,done=0;const workers=Array.from({length:Math.min(4,state.symbols.length)},async()=>{
  while(cursor<state.symbols.length){const item=state.symbols[cursor++];try{if(!state.rawBySymbol.has(item.symbol)){const raw=await getCandles(item.symbol);state.rawBySymbol.set(item.symbol,raw);}done++;$('dataStatus').textContent='Backtesting '+done+' / '+state.symbols.length+' instrumentos…';}catch(e){state.rawBySymbol.set(item.symbol,[]);done++;}}
 });
 await Promise.all(workers);
 const allTrades=[];
 for(const item of state.symbols){const raw=state.rawBySymbol.get(item.symbol)||[];if(!raw.length)continue;const candles=aggregate(raw,state.tf);if(candles.length<70)continue;const calc=buildSetups(candles),trades=simulate(candles,calc.setups);allTrades.push(...trades.map(t=>({...t,symbol:item.symbol})));}
 state.marketBacktests=allTrades;
 const closed=allTrades.filter(t=>t.result==='GANADA'||t.result==='PERDIDA');
 $('wins').textContent=closed.filter(t=>t.result==='GANADA').length;$('losses').textContent=closed.filter(t=>t.result==='PERDIDA').length;
 $('pending').textContent=allTrades.filter(t=>t.result==='PENDIENTE').length;$('expired').textContent=allTrades.filter(t=>t.result==='CANCELADA').length;
 $('backtestInfo').textContent='Universo: '+state.symbols.length+' instrumentos · M'+state.tf+' · últimas 24 horas · '+allTrades.length+' señales simuladas.';
}
async function analyze(){
 if(state.busy)return;state.busy=true;$('dataStatus').textContent='Cargando gráfico…';
 try{const raw=state.rawBySymbol.get(state.selected)||await getCandles(state.selected);if(!raw.length)throw new Error('No llegaron velas para '+state.selected);
 state.rawCandles=raw;state.lastRecalcBucket=Math.floor(raw.at(-1).time/(state.tf*60));const c=aggregate(raw,state.tf);state.candles=c;const calc=buildSetups(c);state.trades=simulate(c,calc.setups);
 draw(c,calc,state.trades);showLatest(calc,state.trades,c);renderHistory(state.trades);
 $('chartTitle').textContent=(state.symbols.find(s=>s.symbol===state.selected)?.name||state.selected)+' · M'+state.tf;
 $('chartSubtitle').textContent='Velas '+c.length+' · análisis de 24 horas · señales proyectadas';
 $('chartRange').textContent=new Date(c[0].time*1000).toLocaleDateString('es-PA')+' — '+new Date(c.at(-1).time*1000).toLocaleTimeString('es-PA');
 $('dataStatus').textContent='Datos actualizados';
 }catch(e){$('dataStatus').textContent='Error: '+e.message;$('signalDetails').textContent=e.message;}finally{state.busy=false;}
}
function onLiveTick(tick){
 if(!state.selected||tick.symbol!==state.selected||!state.rawCandles.length)return;
 const price=Number(tick.quote),epoch=Number(tick.epoch);if(!Number.isFinite(price)||!Number.isFinite(epoch))return;
 const minute=Math.floor(epoch/60)*60;let last=state.rawCandles[state.rawCandles.length-1];
 if(minute>last.time){state.rawCandles.push({time:minute,open:price,high:price,low:price,close:price});if(state.rawCandles.length>1440)state.rawCandles.shift();}
 else if(minute===last.time){last.high=Math.max(last.high,price);last.low=Math.min(last.low,price);last.close=price;}
 const tfSeconds=state.tf*60,bucket=Math.floor(epoch/tfSeconds)*tfSeconds;
 const group=state.rawCandles.filter(x=>Math.floor(x.time/tfSeconds)*tfSeconds===bucket);
 if(group.length&&state.series.candle){state.series.candle.update({time:bucket,open:group[0].open,high:Math.max(...group.map(x=>x.high)),low:Math.min(...group.map(x=>x.low)),close:price});}
 const recalcBucket=Math.floor(epoch/tfSeconds);
 if(state.lastRecalcBucket!==null&&recalcBucket>state.lastRecalcBucket){state.lastRecalcBucket=recalcBucket;state.rawBySymbol.set(state.selected,state.rawCandles);runUniverseBacktest(false).then(analyze);}
}
function subscribeLive(){if(state.liveSub){try{state.ws.send(JSON.stringify({forget:state.liveSub}));}catch{}}request({ticks:state.selected,subscribe:1}).then(r=>{state.liveSub=r.subscription?.id||null;}).catch(()=>{});}
function bind(){
 $('symbolSelect').addEventListener('change',e=>{state.selected=e.target.value;analyze();subscribeLive();});
 $('timeframes').addEventListener('click',async e=>{const b=e.target.closest('button[data-tf]');if(!b)return;state.tf=+b.dataset.tf;document.querySelectorAll('#timeframes button').forEach(x=>x.classList.toggle('active',x===b));await runUniverseBacktest(false);await analyze();});
 $('refreshBtn').addEventListener('click',async()=>{await runUniverseBacktest(true);await analyze();});$('runBacktest').addEventListener('click',async()=>{await runUniverseBacktest(true);await analyze();});
}
async function start(){bind();try{await loadSymbols();await runUniverseBacktest(false);await analyze();subscribeLive();}catch(e){setConnection(false,'No conectado');$('dataStatus').textContent=e.message;}}
start();
})();