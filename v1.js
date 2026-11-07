(()=>{'use strict';
const $=id=>document.getElementById(id),API='wss://api.derivws.com/trading/v1/options/ws/public',DAY=86400,COUNT=7000;
const S={ws:null,req:0,pending:new Map(),symbols:[],symbol:'',raw:[],candles:[],chart:null,rsiChart:null,price:null,ema9:null,ema45:null,rsiLine:null,markerApi:null,obSeries:[],markers:[],trades:[],point:0,settings:{},scanTimer:null,reconnectTimer:null,reconnectDelay:1000,heartbeatTimer:null,connecting:false,tickCount:0,lastTickAt:0,currentPriceLine:null,liveSymbol:'',markets:new Map(),marketSubs:new Map(),marketSubSymbols:new Map(),marketLastTick:new Map(),activeSignals:new Map(),liveHistory:[],globalScanStarted:false,scanBusy:false};
const STORE='botder-scalping-m1-v1';
function restoreLiveHistory(){try{const saved=JSON.parse(localStorage.getItem(STORE+'-live-history')||'[]');if(Array.isArray(saved))S.liveHistory=saved.filter(x=>x&&x.symbol&&x.side&&Number.isFinite(+x.time)).slice(-2000)}catch{S.liveHistory=[]}}
function persistLiveHistory(){try{localStorage.setItem(STORE+'-live-history',JSON.stringify(S.liveHistory.slice(-2000)))}catch(e){console.warn('No se pudo guardar el historial live',e)}}
function status(t,ok=false){$('connection').textContent=t;$('connection').style.color=ok?'#20d18b':'#ffb95c'}
function send(p){return new Promise((resolve,reject)=>{if(!S.ws||S.ws.readyState!==1)return reject(Error('Deriv desconectada'));const id=++S.req,t=setTimeout(()=>{S.pending.delete(id);reject(Error('Tiempo de espera de Deriv'))},20000);S.pending.set(id,{resolve:x=>{clearTimeout(t);resolve(x)},reject:e=>{clearTimeout(t);reject(e)}});S.ws.send(JSON.stringify({...p,req_id:id}))})}
function stopHeartbeat(){if(S.heartbeatTimer){clearInterval(S.heartbeatTimer);S.heartbeatTimer=null}}
function scheduleReconnect(){if(S.reconnectTimer)return;const wait=S.reconnectDelay;status('Deriv desconectada · reconectando…');S.reconnectTimer=setTimeout(async()=>{S.reconnectTimer=null;try{await connect();S.reconnectDelay=1000;await loadSymbols();if(S.symbol&&S.symbols.some(x=>x.code===S.symbol))$('symbol').value=S.symbol;await loadCurrent()}catch(e){status('Reintentando conexión…');S.reconnectDelay=Math.min(30000,S.reconnectDelay*2);scheduleReconnect()}},wait)}
function connect(){if(S.connecting)return Promise.reject(Error('Conexión en curso'));S.connecting=true;return new Promise((resolve,reject)=>{const ws=new WebSocket(API);S.ws=ws;let settled=false;const timer=setTimeout(()=>{if(!settled){settled=true;S.connecting=false;try{ws.close()}catch{}reject(Error('Tiempo de espera conectando Deriv'))}},12000);ws.onopen=()=>{if(ws!==S.ws){ws.close();return}clearTimeout(timer);settled=true;S.connecting=false;S.reconnectDelay=1000;status('Deriv conectada',true);stopHeartbeat();S.heartbeatTimer=setInterval(()=>{if(S.ws===ws&&ws.readyState===1)send({ping:1}).catch(()=>{try{ws.close()}catch{}})},30000);resolve()};ws.onerror=()=>{clearTimeout(timer);if(!settled){settled=true;S.connecting=false;reject(Error('Error de conexión Deriv'))}};ws.onclose=()=>{if(ws!==S.ws)return;clearTimeout(timer);S.connecting=false;stopHeartbeat();S.marketSubs.clear();S.marketSubSymbols.clear();S.marketLastTick.clear();S.globalScanStarted=false;status('Deriv desconectada');for(const p of S.pending.values())p.reject(Error('Conexión cerrada'));S.pending.clear();scheduleReconnect()};ws.onmessage=e=>{let m;try{m=JSON.parse(e.data)}catch{return}if(m.msg_type==='tick'&&m.tick){try{const subId=m.subscription?.id||m.tick.subscription?.id;const mappedSymbol=subId?S.marketSubSymbols.get(subId):null;if(mappedSymbol){const routedTick={...m.tick,symbol:mappedSymbol};if(mappedSymbol===S.symbol)updateLiveTick(routedTick);else updateMarketTick(routedTick)}else{updateLiveTick(m.tick)}}catch(err){console.error('Error procesando tick global',m.tick.symbol,err)}}if(m.req_id&&S.pending.has(m.req_id)){const p=S.pending.get(m.req_id);S.pending.delete(m.req_id);m.error?p.reject(Error(m.error.message)):p.resolve(m)}}})}
async function loadSymbols(){
 const r=await send({active_symbols:'brief'});
 const allowed=(r.active_symbols||[]).filter(x=>!Number(x.is_trading_suspended)).map(x=>{
  const name=String(x.display_name||x.underlying_symbol_name||x.symbol||'').trim();
  const code=x.underlying_symbol||x.symbol;
  return{code,name,pip:Number(x.pip)||0};
 }).filter(x=>{
  if(!x.code||!x.name)return false;
  const n=x.name.replace(/\s+/g,' ').trim();
  if(/^(?:Crash|Boom)\s+(?:50|500)\s+Index$/i.test(n))return true;
  const v=n.match(/^Volatility\s+(\d+)(?:\s*\(1s\))?\s+Index$/i);
  return !!v&&Number(v[1])>=10&&Number(v[1])<=75;
 });
 const unique=new Map();for(const x of allowed)if(!unique.has(x.code))unique.set(x.code,x);
 S.symbols=[...unique.values()].sort((a,b)=>{
  const group=x=>/^Volatility/i.test(x.name)?0:/^Crash/i.test(x.name)?1:2;
  const ga=group(a),gb=group(b);if(ga!==gb)return ga-gb;
  const num=x=>Number((x.name.match(/\d+/)||[])[0]||0);
  if(num(a)!==num(b))return num(a)-num(b);
  return a.name.localeCompare(b.name);
 });
 $('symbol').innerHTML=S.symbols.map(x=>'<option value="'+x.code+'">'+x.name+'</option>').join('');
 if(!S.symbols.length)throw Error('Deriv no devolvió instrumentos permitidos (Volatility 10–75, Crash/Boom 50/500)');
}
async function history(symbol){
 const target=COUNT,chunk=4000,all=[];let receivedRaw=0,invalid=0;
 const first=await send({ticks_history:symbol,adjust_start_time:1,count:chunk,end:'latest',granularity:60,style:'candles'});
 const clean=r=>{const rows=r.candles||[];receivedRaw+=rows.length;const valid=rows.map(x=>({time:+x.epoch,open:+x.open,high:+x.high,low:+x.low,close:+x.close})).filter(x=>Number.isFinite(x.time)&&Number.isFinite(x.open)&&Number.isFinite(x.high)&&Number.isFinite(x.low)&&Number.isFinite(x.close)&&x.high>=Math.max(x.open,x.close)&&x.low<=Math.min(x.open,x.close));invalid+=rows.length-valid.length;return valid};
 all.push(...clean(first));
 if(all.length<target&&all.length){
  const oldest=Math.min(...all.map(x=>x.time));
  const second=await send({ticks_history:symbol,adjust_start_time:1,count:target-all.length,end:String(oldest-60),granularity:60,style:'candles'});
  all.push(...clean(second));
 }
 const unique=new Map();for(const x of all)unique.set(x.time,x);
 const sorted=[...unique.values()].sort((a,b)=>a.time-b.time);
 const lastClosed=Math.floor(Date.now()/60000)*60-60;
 const complete=sorted.filter(x=>x.time<=lastClosed);
 if(!complete.length)throw Error('Deriv no entregó velas M1 válidas');
 S.dataQuality={received:complete.length,requested:target,duplicates:all.length-sorted.length,invalid,last:complete.at(-1)?.time||0,gaps:0};
 for(let i=1;i<complete.length;i++)if(complete[i].time-complete[i-1].time>60)S.dataQuality.gaps+=Math.floor((complete[i].time-complete[i-1].time)/60)-1;
 return complete;
}
function aggregate(c,n){const map=new Map();for(const x of c){const t=Math.floor(x.time/(n*60))*n*60;let b=map.get(t);if(!b){b={time:t,open:x.open,high:x.high,low:x.low,close:x.close,count:0};map.set(t,b)}b.high=Math.max(b.high,x.high);b.low=Math.min(b.low,x.low);b.close=x.close;b.count++}return [...map.values()].filter((x,i,a)=>x.count===n||i===a.length-1).map(({count,...x})=>x)}
function ema(c,p){const out=Array(c.length).fill(null),k=2/(p+1);let v=null;c.forEach((x,i)=>{v=v===null?x.close:x.close*k+v*(1-k);out[i]=v});return out}
function rsi(c,p=14){const out=Array(c.length).fill(null);let g=0,l=0;for(let i=1;i<c.length;i++){let d=c[i].close-c[i-1].close,a=Math.max(d,0),b=Math.max(-d,0);if(i<=p){g+=a;l+=b;if(i===p){g/=p;l/=p}}else{g=(g*(p-1)+a)/p;l=(l*(p-1)+b)/p}if(i>=p)out[i]=l===0?100:100-100/(1+g/l)}return out}
function trend(c){if(c.length<50)return'NEUTRAL';const a=ema(c,9),b=ema(c,20),i=c.length-1;return a[i]>b[i]?'BUY':a[i]<b[i]?'SELL':'NEUTRAL'}
function zigzag(c,depth=10,sep=3){const pts=[];for(let i=depth;i<c.length-depth;i++){let hi=true,lo=true;for(let j=1;j<=depth;j++){if(c[i].high<c[i-j].high||c[i].high<c[i+j].high)hi=false;if(c[i].low>c[i-j].low||c[i].low>c[i+j].low)lo=false}if(hi||lo){const p={index:i,time:c[i].time,price:hi?c[i].high:c[i].low,type:hi?'HIGH':'LOW',confirmed:i+depth};const last=pts.at(-1);if(!last||last.type!==p.type){if(!last||i-last.index>=sep)pts.push(p)}else if((p.type==='HIGH'&&p.price>last.price)||(p.type==='LOW'&&p.price<last.price))pts[pts.length-1]=p}}return pts}
function obZones(m15){
 const zones=[],lookback=5;
 for(let i=lookback+1;i<m15.length;i++){
  const impulse=m15[i],prior=m15.slice(i-lookback,i),priorHigh=Math.max(...prior.map(x=>x.high)),priorLow=Math.min(...prior.map(x=>x.low));
  const body=Math.abs(impulse.close-impulse.open),avg=prior.reduce((s,x)=>s+Math.abs(x.close-x.open),0)/prior.length;
  if(body<avg*1.25)continue;
  if(impulse.close>impulse.open&&impulse.close>priorHigh){
   let p=null;for(let k=i-1;k>=Math.max(0,i-4);k--)if(m15[k].close<m15[k].open){p=m15[k];break}
   if(p){const low=Math.min(p.open,p.close),high=Math.max(p.open,p.close);if(high>low)zones.push({time:p.time,confirmedAt:impulse.time+900,low,high,side:'BUY'})}
  }
  if(impulse.close<impulse.open&&impulse.close<priorLow){
   let p=null;for(let k=i-1;k>=Math.max(0,i-4);k--)if(m15[k].close>m15[k].open){p=m15[k];break}
   if(p){const low=Math.min(p.open,p.close),high=Math.max(p.open,p.close);if(high>low)zones.push({time:p.time,confirmedAt:impulse.time+900,low,high,side:'SELL'})}
  }
 }
 return zones.filter((z,i,a)=>a.findIndex(q=>q.time===z.time&&q.side===z.side)===i);
}
function readConfigs(){try{return JSON.parse(localStorage.getItem(STORE)||'{}')}catch{return {}}}
function config(symbol=S.symbol){
 const all=readConfigs(),saved=all.bySymbol&&all.bySymbol[symbol];
 return saved||all.global||{tp:12,sl:12};
}
function saveConfig(){
 const all=readConfigs();
 if(!all.bySymbol||typeof all.bySymbol!=='object')all.bySymbol={};
 all.bySymbol[S.symbol]={
  tp:Math.max(1,+$('tpPoints').value||12),
  sl:Math.max(1,+$('slPoints').value||12)
 };
 localStorage.setItem(STORE,JSON.stringify(all));
 $('settingsStatus').textContent='Guardado para '+S.symbol;
}
const TP_SL_REFERENCE_PRICE=9592.00;
// Calcula en el espacio de referencia y devuelve TP/SL convertidos al precio REAL.
function calculateTpSl(realEntry,side,point,cfg){
 const factor=realEntry/TP_SL_REFERENCE_PRICE;
 if(!Number.isFinite(factor)||factor<=0)throw Error('Precio inválido para normalizar TP/SL');
 const normalizedEntry=realEntry/factor; // equivale a 9592.00
 const direction=side==='BUY'?1:-1;
 const normalizedTp=normalizedEntry+direction*(cfg.tp*point);
 const normalizedSl=normalizedEntry-direction*(cfg.sl*point);
 return {tp:normalizedTp*factor,sl:normalizedSl*factor,scale:factor,normalizedEntry};
}
function symbolMeta(symbol=S.symbol,c=S.raw){const sym=S.symbols.find(x=>x.code===symbol),prices=(c||[]).slice(-100).map(x=>String(x.close)),digits=Math.max(0,...prices.map(x=>(x.split('.')[1]||'').length));const pip=Number(sym?.pip)||0;const point=pip>0?pip:Math.pow(10,-Math.min(8,digits||2));const decimals=Math.max(0,Math.min(8,pip>0?Math.max(0,Math.ceil(-Math.log10(pip)-1e-9)):digits));return{point,decimals}}
function getPoint(){return symbolMeta(S.symbol,S.raw).point}
function formatPrice(symbol,price,c){return Number(price).toFixed(symbolMeta(symbol,c).decimals)}
function signalsFor(c,asOfEnd=true,symbol=S.symbol){
 const m15=aggregate(c,15),zones=obZones(m15),fast=ema(c,9),slow=ema(c,20),rv=rsi(c),out=[];
 const meta=symbolMeta(symbol,c),point=meta.point,used=new Set();let lastEntryTime=-1;
 for(let i=3;i<c.length;i++){
  const bar=c[i],closeTime=bar.time+60;if(asOfEnd&&closeTime>Date.now()/1000)continue;
  if(rv[i]==null||fast[i]==null||slow[i]==null)continue;
  const gap=Math.abs(fast[i]-slow[i]),avgRange=c.slice(Math.max(1,i-14),i+1).reduce((s,x)=>s+(x.high-x.low),0)/Math.min(15,i);
  const lateral=gap<=Math.max(point*2,avgRange*0.08);
  const rising=fast[i]>fast[i-2]&&slow[i]>slow[i-2],falling=fast[i]<fast[i-2]&&slow[i]<slow[i-2];
  if(lateral||closeTime<=lastEntryTime)continue;
  let side=null;
  if(fast[i]>slow[i]&&rising)side='BUY';
  else if(fast[i]<slow[i]&&falling)side='SELL';
  if(!side)continue;
  const candle=bar,bodyConfirm=side==='BUY'?candle.close>candle.open&&candle.close>fast[i]:candle.close<candle.open&&candle.close<fast[i];
  if(!bodyConfirm)continue;
  const candidates=zones.filter(z=>z.side===side&&z.confirmedAt<=bar.time&&!used.has(z.time+':'+z.side)&&bar.low<=z.high&&bar.high>=z.low);
  if(!candidates.length)continue;
  const zone=candidates.at(-1),entry=candle.close,cfg=config(symbol);
  const levels=calculateTpSl(entry,side,point,cfg);
  out.push({symbol,side,time:closeTime,price:entry,tp:levels.tp,sl:levels.sl,point,decimals:meta.decimals,scale:levels.scale,normalizedEntry:levels.normalizedEntry,rsi:rv[i],trend15:side,trend5:side,obTime:zone.time,obLow:zone.low,obHigh:zone.high});
  used.add(zone.time+':'+zone.side);lastEntryTime=closeTime;
 }
 return out;
}
function resolveTrades(signals,c){const out=[];for(let n=0;n<signals.length;n++){const s=signals[n],next=signals[n+1],bars=c.filter(x=>x.time>=s.time);let result='OPEN',exitTime=null;for(const b of bars){const hitSL=s.side==='BUY'?b.low<=s.sl:b.high>=s.sl,hitTP=s.side==='BUY'?b.high>=s.tp:b.low<=s.tp;if(hitSL&&hitTP){result='LOSS';exitTime=b.time+60;break}if(hitSL){result='LOSS';exitTime=b.time+60;break}if(hitTP){result='WIN';exitTime=b.time+60;break}if(next&&b.time>=next.time){result='CLOSED';exitTime=b.time+60;break}}out.push({...s,result,exitTime})}return out}
function backtest48h(c){const now=Math.floor(Date.now()/1000),cutoff=now-48*3600;return resolveTrades(signalsFor(c),c).filter(x=>x.time>=cutoff&&x.time<=now)}
function initCharts(){if(!window.LightweightCharts)throw Error('No cargó el gráfico');const L=LightweightCharts;$('chart').innerHTML='';$('rsiChart').innerHTML='';S.chart=L.createChart($('chart'),{autoSize:true,layout:{background:{type:'solid',color:'#0a1320'},textColor:'#aab9ca'},grid:{vertLines:{color:'#1b2a3d'},horzLines:{color:'#1b2a3d'}},timeScale:{timeVisible:true,borderColor:'#34445a'},rightPriceScale:{borderColor:'#34445a'},handleScroll:{mouseWheel:true,pressedMouseMove:true,horzTouchDrag:true},handleScale:{mouseWheel:true,pinch:true}});S.price=S.chart.addSeries(L.CandlestickSeries,{upColor:'#20d18b',downColor:'#ff5968',wickUpColor:'#20d18b',wickDownColor:'#ff5968',borderVisible:false,lastValueVisible:true,priceLineVisible:false});S.markerApi=L.createSeriesMarkers?L.createSeriesMarkers(S.price,[]):null;S.ema9=S.chart.addSeries(L.LineSeries,{color:'#318bff',lineWidth:2,priceLineVisible:false,title:'EMA 9'});S.ema20=S.chart.addSeries(L.LineSeries,{color:'#ff9d28',lineWidth:2,priceLineVisible:false,title:'EMA 20'});S.rsiChart=L.createChart($('rsiChart'),{autoSize:true,layout:{background:{type:'solid',color:'#0a1320'},textColor:'#aab9ca'},grid:{vertLines:{color:'#1b2a3d'},horzLines:{color:'#1b2a3d'}},timeScale:{visible:false},rightPriceScale:{borderColor:'#34445a'}});S.rsiLine=S.rsiChart.addSeries(L.LineSeries,{color:'#b36bff',lineWidth:2,priceLineVisible:false});[25,50,75].forEach((level,i)=>S.rsiLine.createPriceLine({price:level,color:i===1?'#8796aa':i===0?'#ff5968':'#20d18b',lineWidth:1,lineStyle:2,axisLabelVisible:true,title:String(level)}));}
function drawChart(){const c=S.raw,m9=ema(c,9),m45=ema(c,20),rv=rsi(c),signals=S.trades;S.price.setData(c);updatePriceLine(c.at(-1)?.close);S.ema9.setData(c.map((x,i)=>({time:x.time,value:m9[i]})));S.ema20.setData(c.map((x,i)=>({time:x.time,value:m45[i]})));S.rsiLine.setData(c.map((x,i)=>rv[i]==null?null:{time:x.time,value:rv[i]}).filter(Boolean));renderSignalMarkers();const to=Math.floor(Date.now()/1000),from=to-48*3600;try{S.chart.timeScale().setVisibleRange({from,to});S.rsiChart.timeScale().setVisibleRange({from,to})}catch{}drawOverlay(obZones(aggregate(S.raw,15)));const last=rv.at(-1),d15=trend(aggregate(S.raw,15)),d5=trend(aggregate(S.raw,5));$('trend15').textContent=d15==='BUY'?'ALCISTA':d15==='SELL'?'BAJISTA':'LATERAL';$('trend5').textContent=d5==='BUY'?'ALCISTA':d5==='SELL'?'BAJISTA':'LATERAL';$('trend15').style.color=d15==='BUY'?'var(--green)':d15==='SELL'?'var(--red)':'#ffc45d';$('trend5').style.color=d5==='BUY'?'var(--green)':d5==='SELL'?'var(--red)':'#ffc45d';$('rsiValue').textContent=last==null?'—':last.toFixed(1);const rs=last>=50&&last<=75?'RSI COMPRA':last>=25&&last<50?'RSI VENTA':'RSI NEUTRAL';$('rsiState').textContent=rs;$('rsiState').style.color=rs.includes('COMPRA')?'var(--green)':rs.includes('VENTA')?'var(--red)':'#ffc45d';const latest=selectedChartTrades().at(-1);$('signalState').textContent=latest?(latest.side==='BUY'?'COMPRA':'VENTA')+' · '+(latest.result==='WIN'?'GANADA':latest.result==='LOSS'?'PERDIDA':latest.result==='OPEN'?'ABIERTA':'CERRADA'):'SIN OPERACIÓN';$('chartName').textContent=S.symbol+' · M1';const m15=aggregate(S.raw,15),zones=obZones(m15).slice(-4);$('rsiCaption').textContent='RSI '+(last==null?'—':last.toFixed(1))+' · '+rs+' · M15 '+$('trend15').textContent+' / M5 '+$('trend5').textContent;return zones}

function drawOverlay(zones){
 const host=$('chart');
 host.querySelectorAll('.v1-overlay,.trade-overlay').forEach(x=>x.remove());
 const layer=document.createElement('div');layer.className='v1-overlay';host.insertBefore(layer,host.firstChild);
 const tradeLayer=document.createElement('div');tradeLayer.className='trade-overlay';host.appendChild(tradeLayer);
 const end=Math.floor(Date.now()/1000),cutoff=end-48*3600;
 const allZones=(zones||[]).filter(z=>z.time>=cutoff).slice(-4);
 for(const z of allZones){
  const el=document.createElement('div');el.className='obbox '+(z.side==='BUY'?'buy':'sell');
  el.textContent=z.side==='BUY'?'OB ALCISTA M15':'OB BAJISTA M15';el.style.color=z.side==='BUY'?'#20d18b':'#ff5968';
  layer.appendChild(el);z._el=el;z._end=z.time+900;
 }
 const areas=[];
 for(const t of selectedChartTrades()){
  if(!Number.isFinite(+t.time)||!Number.isFinite(+t.price)||!Number.isFinite(+t.tp)||!Number.isFinite(+t.sl))continue;
  for(const kind of ['entry','tp','sl']){
   const el=document.createElement('div');el.className='trade-zone '+kind;
   const label=document.createElement('span');label.className='trade-label '+kind;
   tradeLayer.append(el,label);areas.push({el,label,t,kind});
  }
 }
 const update=()=>{
  if(!S.chart||!S.price||!host.isConnected)return;
  const ts=S.chart.timeScale(),width=host.clientWidth,height=host.clientHeight,now=Math.floor(Date.now()/1000);
  const firstTime=S.raw[0]?.time??0,lastTime=S.raw.at(-1)?.time??now;
  const scale=S.price.priceScale();
  let range=null;try{range=scale.getVisiblePriceRange?.()||null}catch{}
  const mapY=p=>{
   const direct=S.price.priceToCoordinate(p);
   if(Number.isFinite(direct))return direct;
   // Respaldo: reconstruir coordenada con el rango visible de precio.
   let min=range?.minValue,max=range?.maxValue;
   if(!(Number.isFinite(min)&&Number.isFinite(max)&&max>min)){
    try{max=S.price.coordinateToPrice(0);min=S.price.coordinateToPrice(height)}catch{}
   }
   if(Number.isFinite(min)&&Number.isFinite(max)&&max>min)
    return height*(max-p)/(max-min);
   return null;
  };
  for(const z of allZones){
   const rawX1=ts.timeToCoordinate(z.time),rawX2=ts.timeToCoordinate(z._end);
   const y1=mapY(z.high),y2=mapY(z.low);
   if(y1==null||y2==null){z._el.style.display='none';continue}
   const x1=rawX1==null?(z.time<=firstTime?0:width):rawX1;
   const right=rawX2==null?(z._end>=lastTime?width:(z._end<firstTime?0:null)):rawX2;
   if(right==null||right<0||x1>width||right<=0){z._el.style.display='none';continue}
   const left=Math.max(0,x1),endX=Math.min(width,right),top=Math.max(0,Math.min(y1,y2)),bottom=Math.min(height,Math.max(y1,y2));
   if(endX<=left||bottom<=top){z._el.style.display='none';continue}
   z._el.style.display='block';z._el.style.left=left+'px';z._el.style.width=(endX-left)+'px';
   z._el.style.top=top+'px';z._el.style.height=(bottom-top)+'px';
  }
  for(const a of areas){
   const hasExitTime=a.t.exitTime!==null&&a.t.exitTime!==undefined&&a.t.exitTime!==''&&Number.isFinite(Number(a.t.exitTime))&&Number(a.t.exitTime)>0;
   const tradeEnd=hasExitTime?Number(a.t.exitTime):now+60;
   const rawX1=ts.timeToCoordinate(+a.t.time-60),rawX2=ts.timeToCoordinate(tradeEnd);
   let x1=rawX1,x2=rawX2;
   if(x1==null)x1=(+a.t.time-60<=firstTime?0:(+a.t.time-60>lastTime?width:null));
   if(x2==null)x2=(tradeEnd>=lastTime?width:(tradeEnd<firstTime?0:null));
   const level=a.kind==='entry'?+a.t.price:a.kind==='tp'?+a.t.tp:+a.t.sl,y1=mapY(+a.t.price),y2=mapY(level);
   if(x1==null||x2==null||y1==null||y2==null||Math.max(x1,x2)<=0||Math.min(x1,x2)>=width){
    a.el.style.display='none';a.label.style.display='none';continue;
   }
   const left=Math.max(0,Math.min(x1,x2)),right=Math.min(width,Math.max(x1,x2));
   const top=Math.max(0,Math.min(y1,y2)),bottom=Math.min(height,Math.max(y1,y2));
   if(right<=left||(a.kind!=='entry'&&bottom<=top)){a.el.style.display='none';a.label.style.display='none';continue}
   a.el.style.display='block';
   // La línea de ENTRADA queda dentro del mismo ancho de los recuadros TP/SL.
   const zoneLeft=a.kind==='entry'?Math.min(right,left+2):left;
   const zoneRight=a.kind==='entry'?Math.max(zoneLeft,right-2):right;
   a.el.style.left=zoneLeft+'px';a.el.style.width=Math.max(0,zoneRight-zoneLeft)+'px';
   a.el.style.top=(a.kind==='entry'?Math.max(0,Math.min(height-1,y1)):top)+'px';a.el.style.height=(a.kind==='entry'?'1px':Math.max(1,bottom-top)+'px');
   a.label.style.display='block';
   const decimals=Number.isInteger(a.t.decimals)?a.t.decimals:symbolMeta(S.symbol,S.raw).decimals;
   a.label.textContent=(a.kind==='entry'?'ENTRADA ':a.kind==='tp'?'TP ':'SL ')+level.toFixed(decimals);
   a.label.style.left=Math.max(0,Math.min(width-82,left))+'px';
   a.label.style.top=Math.max(0,Math.min(height-13,a.kind==='entry'?y1-14:a.kind==='tp'?top+1:bottom-13))+'px';
  }
  renderSignalMarkers();
 };
 host._updateTradeOverlay=update;
 // Recalcular al cambiar el rango horizontal del gráfico.
 if(host._tradeOverlayRangeHandler)try{S.chart.timeScale().unsubscribeVisibleLogicalRangeChange(host._tradeOverlayRangeHandler)}catch{}
 host._tradeOverlayRangeHandler=update;
 S.chart.timeScale().subscribeVisibleLogicalRangeChange(update);
 // Recalcular también al cambiar el rango vertical de precios. Así TP/SL
 // reaparecen cuando el usuario mueve o ajusta la escala vertical.
 const priceScale=S.price.priceScale();
 if(host._tradeOverlayPriceHandler&&host._tradeOverlayPriceScale){
  try{host._tradeOverlayPriceScale.unsubscribeVisiblePriceRangeChange(host._tradeOverlayPriceHandler)}catch{}
 }
 host._tradeOverlayPriceScale=priceScale;
 host._tradeOverlayPriceHandler=update;
 try{priceScale.subscribeVisiblePriceRangeChange?.(update)}catch(e){console.warn('No se pudo suscribir el rango vertical del overlay',e)}
 // Recalcular cuando cambia el tamaño del área del gráfico.
 if(host._tradeOverlaySizeHandler&&S.chart.unsubscribeSizeChange){
  try{S.chart.unsubscribeSizeChange(host._tradeOverlaySizeHandler)}catch{}
 }
 host._tradeOverlaySizeHandler=update;
 try{S.chart.subscribeSizeChange?.(update)}catch{}
 requestAnimationFrame(update);
}
function selectedChartTrades(){
 const merged=new Map();
 const validPrice=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v))&&Number(v)>0;
 const add=x=>{
  if(!x||x.symbol!==S.symbol||!Number.isFinite(+x.time)||!['BUY','SELL'].includes(x.side)||!validPrice(x.price))return;
  const key=x.symbol+'|'+x.side+'|'+x.time,prior=merged.get(key)||{};
  let price=validPrice(x.price)?Number(x.price):prior.price;
  let tp=validPrice(x.tp)?Number(x.tp):prior.tp,sl=validPrice(x.sl)?Number(x.sl):prior.sl;
  // Si una fuente antigua trae entrada sin TP/SL, completar desde la configuración
  // guardada para ese instrumento, sin alterar el cálculo del backtesting.
  if(validPrice(price)&&(!validPrice(tp)||!validPrice(sl))){
   try{const point=validPrice(x.point)?Number(x.point):symbolMeta(x.symbol,x.candles||S.raw).point;const levels=calculateTpSl(price,x.side,point,config(x.symbol));tp=levels.tp;sl=levels.sl}catch(e){console.warn('No se pudieron completar TP/SL de la entrada',key,e)}
  }
  merged.set(key,{...prior,...x,price,tp,sl,decimals:Number.isInteger(x.decimals)?x.decimals:prior.decimals});
 };
 for(const x of S.trades)add(x);
 for(const x of S.liveHistory)add(x);
 for(const x of S.activeSignals.values())add(x);
 return [...merged.values()].filter(x=>validPrice(x.price)&&validPrice(x.tp)&&validPrice(x.sl)).sort((a,b)=>a.time-b.time);
}
function renderSignalMarkers(){
 const host=$('chart');
 if(!host||!S.chart||!S.price)return;
 // Los marcadores nativos se anclan al máximo/mínimo móvil de la vela.
 // Estas estrellas DOM se colocan en el precio REAL y fijo de entrada.
 try{if(S.markerApi)S.markerApi.setMarkers([]);else if(S.price.setMarkers)S.price.setMarkers([])}catch{}
 let layer=host.querySelector('.entry-star-layer');
 if(!layer){layer=document.createElement('div');layer.className='entry-star-layer';host.appendChild(layer)}
 const trades=selectedChartTrades(),wanted=new Set(),existing=new Map([...layer.children].map(el=>[el.dataset.key,el]));
 for(const s of trades){
  const key=s.symbol+'|'+s.side+'|'+s.time;
  wanted.add(key);
  let el=existing.get(key);
  if(!el){el=document.createElement('span');el.className='entry-star';el.textContent='★';el.dataset.key=key;layer.appendChild(el)}
  el.className='entry-star '+(s.side==='BUY'?'buy':'sell');
  const x=S.chart.timeScale().timeToCoordinate(+s.time-60);
  const y=S.price.priceToCoordinate(+s.price);
  if(!Number.isFinite(x)||!Number.isFinite(y)||x<0||x>host.clientWidth||y<0||y>host.clientHeight){el.style.display='none';continue}
  el.style.display='block';el.style.left=x+'px';el.style.top=y+'px';
 }
 for(const [key,el] of existing)if(!wanted.has(key))el.remove();
}
function restoreOpenSignals(symbol,candles){
 if(!Array.isArray(candles)||candles.length<30)return 0;
 // Reconstruir cada señal por separado. No cerrar una señal porque aparezca
 // otra posterior: solo deja de estar vigente cuando toca su TP o su SL.
 const candidates=signalsFor(candles,true,symbol),market=S.markets.get(symbol);
 let restored=0;
 for(const signal of candidates){
  const bars=candles.filter(b=>b.time>=signal.time);
  let closed=false;
  for(const bar of bars){
   const hitSL=signal.side==='BUY'?bar.low<=signal.sl:bar.high>=signal.sl;
   const hitTP=signal.side==='BUY'?bar.high>=signal.tp:bar.low<=signal.tp;
   if(hitSL||hitTP){closed=true;break}
  }
  if(closed)continue;
  const key=symbol+'|'+signal.side+'|'+signal.time;
  if(S.activeSignals.has(key)||S.liveHistory.some(x=>x.symbol===symbol&&x.side===signal.side&&x.time===signal.time))continue;
  S.activeSignals.set(key,{...signal,key,name:market?.name||S.symbols.find(x=>x.code===symbol)?.name||symbol,result:'OPEN',candles:candles.slice(-120)});
  restored++;
 }
 renderActiveSignals();
 return restored;
}
function renderActiveSignals(){
 const host=$('activeSignals');if(!host)return;
 const items=[...S.activeSignals.values()].sort((a,b)=>b.time-a.time);
 host.replaceChildren();host.hidden=!items.length;
 for(const s of items){
  const card=document.createElement('article');card.className='active-signal '+(s.side==='BUY'?'buy':'sell');
  const head=document.createElement('b');head.textContent=(s.side==='BUY'?'COMPRAR':'VENDER')+' · '+s.name;
  const prices=document.createElement('div');prices.className='active-signal-prices';
  for(const [label,value] of [['PRECIO ESPERADO',s.price],['TP',s.tp],['SL',s.sl]]){
   const cell=document.createElement('span');cell.textContent=label+' '+formatPrice(s.symbol,value,s.candles);prices.append(cell);
  }
  const state=document.createElement('strong');state.textContent='ESPERANDO PRECIO · '+new Date(s.time*1000).toLocaleTimeString('es-PA',{hour:'2-digit',minute:'2-digit'});
  card.append(head,prices,state);host.append(card);
 }
}
function notifySignalResult(signal,result){
 const host=$('signalNotices');if(!host)return;host.hidden=false;const card=document.createElement('article');card.className='signal-notice '+(result==='WIN'?'buy':'sell');const title=document.createElement('b');title.className='notice-title';title.textContent=(result==='WIN'?'✓ GANADA':'✕ PERDIDA')+' · '+signal.name;const details=document.createElement('div');details.className='notice-details';details.textContent=(signal.side==='BUY'?'COMPRA':'VENTA')+' · '+result;card.append(title,details);host.prepend(card);while(host.children.length>4)host.lastElementChild.remove();setTimeout(()=>{card.remove();if(!host.children.length)host.hidden=true},8000);
}
function updateSelectedSignalView(){
 if(!S.chart||!S.price)return;renderSignalMarkers();drawOverlay(obZones(aggregate(S.raw,15)));renderHistory();
}
function updateMarketTrade(signal,price,time){
 if(signal.result!=='OPEN')return false;const hitSL=signal.side==='BUY'?price<=signal.sl:price>=signal.sl,hitTP=signal.side==='BUY'?price>=signal.tp:price<=signal.tp;
 if(hitSL||hitTP){signal.result=hitTP?'WIN':'LOSS';signal.exitTime=time;S.liveHistory.push({...signal,candles:undefined});if(S.liveHistory.length>2000)S.liveHistory.shift();persistLiveHistory();notifySignalResult(signal,signal.result);S.activeSignals.delete(signal.key);return true}return false;
}
function processMarketSignal(symbol,candles,price,time){
 if(!candles||!candles.length)return;let changed=false;
 for(const s of [...S.activeSignals.values()])if(s.symbol===symbol)changed=updateMarketTrade(s,price,time)||changed;
 const last=candles.at(-1),candidate=signalsFor(candles,false,symbol).find(x=>x.time===last.time+60);
 if(candidate){
  const samePoint=[...S.liveHistory,...S.activeSignals.values()].some(x=>x.symbol===symbol&&x.side===candidate.side&&x.obTime===candidate.obTime);
  if(!samePoint){const key=symbol+'|'+candidate.side+'|'+candidate.time,market=S.markets.get(symbol),item={...candidate,key,name:market?.name||symbol,result:'OPEN',candles:candles.slice()};S.activeSignals.set(key,item);notifyNewSignal(item);changed=true}
 }
 renderActiveSignals();if(changed&&symbol===S.symbol)updateSelectedSignalView();
}
function updateMarketTick(tick){
 const symbol=tick.symbol;if(!symbol||!Number.isFinite(+tick.epoch)||!Number.isFinite(+tick.quote))return;const market=S.markets.get(symbol);if(!market)return;
 S.marketLastTick.set(symbol,Date.now());const time=Math.floor(+tick.epoch/60)*60,price=+tick.quote,last=market.candles.at(-1);if(!last)return;
 if(last.time===time){last.high=Math.max(last.high,price);last.low=Math.min(last.low,price);last.close=price}else if(time>last.time){market.candles.push({time,open:last.close,high:Math.max(last.close,price),low:Math.min(last.close,price),close:price});if(market.candles.length>COUNT)market.candles.shift()}else return;
 processMarketSignal(symbol,market.candles,price,+tick.epoch);if(symbol===S.symbol)$('chart')._updateTradeOverlay?.();
}
async function loadGlobalMarket(symbol){
 const existing=S.markets.get(symbol);
 if(existing?.candles?.length>=30)return existing;
 const meta=S.symbols.find(x=>x.code===symbol);if(!meta)throw Error('Instrumento no encontrado: '+symbol);
 // Todos los mercados usan el mismo histórico M1 (7,000 velas) que el gráfico.
 const candles=await history(symbol);
 if(!candles.length)throw Error('Deriv no entregó velas M1 para '+symbol+'; se reintentará');
 const market={name:meta.name,candles};S.markets.set(symbol,market);return market;
}
async function ensureGlobalSubscription(symbol){
 if(S.marketSubs.has(symbol))return;
 const market=await loadGlobalMarket(symbol);
 if(!market?.candles?.length)throw Error('Mercado sin velas M1: '+symbol);
 const r=await send({ticks:symbol,subscribe:1});
 const subscriptionId=r.subscription?.id;
 if(!subscriptionId)throw Error('Deriv no confirmó la suscripción de ticks: '+symbol);
 S.marketSubs.set(symbol,subscriptionId);
 S.marketSubSymbols.set(subscriptionId,symbol);
 S.marketLastTick.set(symbol,Date.now());
 if(r.tick)updateMarketTick(r.tick);
}
async function preloadGlobalMarkets(){
 const queue=S.symbols.filter(x=>(S.markets.get(x.code)?.candles?.length||0)<30);
 let next=0;
 const workers=Array.from({length:Math.min(3,queue.length)},async()=>{
  while(next<queue.length){
   const item=queue[next++];
   try{await loadGlobalMarket(item.code)}catch(e){console.warn('No se pudieron cargar velas de '+item.name+': '+e.message)}
  }
 });
 await Promise.all(workers);
 // Calcular primero todos los instrumentos; el panel se publica una sola vez,
 // cuando terminó la carga inicial de datos disponible.
 for(const item of S.symbols){
  const market=S.markets.get(item.code);
  if(market?.candles?.length>=30)restoreOpenSignals(item.code,market.candles);
 }
 renderActiveSignals();
}
async function scanMissingMarkets(){
 if(S.scanBusy||S.ws?.readyState!==1)return;S.scanBusy=true;
 try{
  // No se suscribe ningún instrumento hasta que exista su histórico M1.
  await preloadGlobalMarkets();
  const queue=S.symbols.filter(item=>{
   const lastTick=S.marketLastTick.get(item.code)||0;
   return !S.marketSubs.has(item.code)||Date.now()-lastTick>=90000;
  });
  let next=0;
  const workers=Array.from({length:Math.min(3,queue.length)},async()=>{
   while(next<queue.length){
    const item=queue[next++];
    if(S.marketSubs.has(item.code)){
     const oldId=S.marketSubs.get(item.code);
     try{await send({forget:oldId})}catch{}
     S.marketSubSymbols.delete(oldId);S.marketSubs.delete(item.code);S.marketLastTick.delete(item.code);
    }
    try{await ensureGlobalSubscription(item.code)}catch(e){console.warn('Reintento escáner '+item.name+': '+e.message)}
   }
  });
  await Promise.all(workers);
  renderActiveSignals();
 }finally{S.scanBusy=false}
}
async function startGlobalScanner(){
 if(S.globalScanStarted)return;S.globalScanStarted=true;
 if(!S.markets.has(S.symbol)&&S.raw?.length)S.markets.set(S.symbol,{name:S.symbols.find(x=>x.code===S.symbol)?.name||S.symbol,candles:S.raw});
 if(S.scanTimer)clearInterval(S.scanTimer);
 S.scanTimer=setInterval(()=>{if(S.ws?.readyState===1)scanMissingMarkets().catch(e=>console.warn('Revisión escáner global',e))},15000);
 await scanMissingMarkets();
}
function notifyNewSignal(signal){
 if(!signal)return;
 const key=signal.symbol+'|'+signal.side+'|'+signal.time;
 if(S.notifiedSignals?.has(key))return;
 if(!S.notifiedSignals)S.notifiedSignals=new Set();
 S.notifiedSignals.add(key);
 if(S.notifiedSignals.size>300)S.notifiedSignals=new Set([...S.notifiedSignals].slice(-150));
 const host=$('signalNotices');if(!host)return;
 host.hidden=false;
 const card=document.createElement('article');
 card.className='signal-notice '+(signal.side==='BUY'?'buy':'sell');
 const title=document.createElement('b');title.className='notice-title';title.textContent=(signal.side==='BUY'?'⭐ B · COMPRA':'⭐ S · VENTA')+'  '+signal.symbol;
 const details=document.createElement('div');details.className='notice-details';
 details.textContent='PRECIO ESPERADO '+formatPrice(signal.symbol,signal.price,signal.candles||S.raw)+'  ·  TP '+formatPrice(signal.symbol,signal.tp,signal.candles||S.raw)+'  ·  SL '+formatPrice(signal.symbol,signal.sl,signal.candles||S.raw);
 const timer=document.createElement('span');timer.className='notice-timer';timer.textContent='45 s';
 card.append(title,details,timer);host.prepend(card);
 while(host.children.length>4)host.lastElementChild.remove();
 const expires=Date.now()+45000;
 const interval=setInterval(()=>{
  const left=Math.max(0,Math.ceil((expires-Date.now())/1000));
  timer.textContent=left+' s';
  if(left<=0){clearInterval(interval);card.remove();if(!host.children.length)host.hidden=true}
 },250);
 setTimeout(()=>{clearInterval(interval);card.remove();if(!host.children.length)host.hidden=true},45100);
}
function updatePriceLine(price){
 if(!S.price||!Number.isFinite(price))return;
 try{if(S.currentPriceLine)S.price.removePriceLine(S.currentPriceLine)}catch{}
 S.currentPriceLine=S.price.createPriceLine({price,color:'#91a4bb',lineWidth:1,lineStyle:2,axisLabelVisible:true,title:'PRECIO'});
}
function updateLiveTick(tick){
 if(!tick||!Number.isFinite(+tick.epoch)||!Number.isFinite(+tick.quote))return;
 if(tick.symbol&&tick.symbol!==S.symbol){updateMarketTick(tick);return;}
 S.tickCount++;S.lastTickAt=Date.now();S.liveSymbol=tick.symbol||S.symbol;if(tick.symbol)S.marketLastTick.set(tick.symbol,Date.now());
 $('liveFeed').textContent='EN VIVO · '+S.tickCount.toLocaleString('es-PA')+' ticks · '+new Date(S.lastTickAt).toLocaleTimeString('es-PA')+' · '+(+tick.quote).toFixed(symbolMeta(S.symbol,S.raw).decimals);
 const time=Math.floor(+tick.epoch/60)*60,price=+tick.quote,last=S.raw.at(-1);
 if(!last)return;
 let bar;
 if(last.time===time){last.high=Math.max(last.high,price);last.low=Math.min(last.low,price);last.close=price;bar=last}
 else if(time>last.time){bar={time,open:last.close,high:Math.max(last.close,price),low:Math.min(last.close,price),close:price};S.raw.push(bar);if(S.raw.length>COUNT)S.raw.shift()}
 else return;
 try{
  S.price.update(bar);updatePriceLine(price);
  const m9=ema(S.raw,9),m20=ema(S.raw,20),rv=rsi(S.raw);
  const i=S.raw.length-1;
  S.ema9.update({time,value:m9[i]});S.ema20.update({time,value:m20[i]});
  if(rv[i]!=null)S.rsiLine.update({time,value:rv[i]});
  $('rsiValue').textContent=rv[i]==null?'—':rv[i].toFixed(1);
  $('chartName').textContent=S.symbol+' · M1 · '+price;
  if(time>last.time){S.trades=backtest48h(S.raw);drawOverlay(obZones(aggregate(S.raw,15)));renderHistory()}
  const current=S.raw.at(-1);processMarketSignal(S.symbol,S.raw,price,+tick.epoch);$('chart')._updateTradeOverlay?.();const liveSignal=[...S.activeSignals.values()].find(x=>x.symbol===S.symbol&&x.time===current.time+60)||null;
  renderSignalMarkers();
  $('liveSignal').textContent=liveSignal?(liveSignal.side==='BUY'?'⭐ B · COMPRA':'⭐ S · VENTA')+' REGISTRADA':'SIN SEÑAL EN VELA ACTUAL';
  $('liveSignal').style.color=liveSignal?(liveSignal.side==='BUY'?'#20d18b':'#ff5968'):'#9aabc0';
 }catch(e){console.error('Error actualizando vela M1 en vivo',e)}
}
async function subscribeLive(){
 S.tickCount=0;S.lastTickAt=0;$('liveFeed').textContent='SUSCRIBIENDO A '+S.symbol+'…';
 if(!S.markets.has(S.symbol))S.markets.set(S.symbol,{name:S.symbols.find(x=>x.code===S.symbol)?.name||S.symbol,candles:S.raw});
 if(S.marketSubs.has(S.symbol))return;
 const r=await send({ticks:S.symbol,subscribe:1});const subscriptionId=r.subscription?.id;if(!subscriptionId)throw Error('Deriv no confirmó la suscripción de '+S.symbol);S.marketSubs.set(S.symbol,subscriptionId);S.marketSubSymbols.set(subscriptionId,S.symbol);S.marketLastTick.set(S.symbol,Date.now());if(r.tick)updateLiveTick(r.tick);
 if(!r.tick)$('liveFeed').textContent='SUSCRIPCIÓN ACEPTADA · esperando primer tick de '+S.symbol;
}
function renderHistory(){const merged=new Map();for(const x of S.trades)merged.set((x.symbol||S.symbol)+'|'+x.side+'|'+x.time,x);for(const x of S.liveHistory.filter(x=>x.symbol===S.symbol))merged.set((x.symbol||S.symbol)+'|'+x.side+'|'+x.time,x);for(const x of S.activeSignals.values())if(x.symbol===S.symbol)merged.set(x.symbol+'|'+x.side+'|'+x.time,x);const rows=[...merged.values()].sort((a,b)=>a.time-b.time),w=rows.filter(x=>x.result==='WIN').length,l=rows.filter(x=>x.result==='LOSS').length,o=rows.filter(x=>x.result==='OPEN').length,neutral=rows.filter(x=>x.result==='CLOSED').length,closed=w+l;$('wins').textContent=w;$('losses').textContent=l;$('open').textContent=o;$('rate').textContent=(closed?100*w/closed:0).toFixed(1)+'%';$('history').innerHTML=rows.slice().reverse().map(x=>'<div class="history-row"><span>'+new Date(x.time*1000).toLocaleString('es-PA',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})+'</span><b class="'+(x.side==='BUY'?'win':'loss')+'">'+(x.side==='BUY'?'COMPRA':'VENTA')+'</b><span>TP '+formatPrice(x.symbol||S.symbol,x.tp,x.candles||S.raw)+' · SL '+formatPrice(x.symbol||S.symbol,x.sl,x.candles||S.raw)+'</span><span class="'+(x.result==='WIN'?'win':x.result==='LOSS'?'loss':'')+'">'+x.result+'</span></div>').join('')||'No se encontraron operaciones con todos los filtros';const to=Math.floor(Date.now()/1000),from=to-48*3600,windowBars=S.raw.filter(x=>x.time>=from&&x.time<=to).length;$('coverage').textContent='VENTANA 48H · '+windowBars.toLocaleString('es-PA')+' velas M1';$('backtestStatus').textContent='PRUEBA HISTÓRICA: '+new Date(from*1000).toLocaleString('es-PA')+' — '+new Date(to*1000).toLocaleString('es-PA')+' · '+rows.length+' entradas ('+w+' ganadas, '+l+' perdidas, '+neutral+' cerradas, '+o+' abiertas) · '+windowBars+' velas M1 en ventana; '+S.raw.length+' velas recibidas para cálculos. Huecos M1 detectados: '+(S.dataQuality?.gaps??'—')+'.'}

async function loadCurrent(){S.symbol=$('symbol').value;localStorage.setItem('botder-current-symbol',S.symbol);status('Cargando datos y señales de todos los instrumentos…');$('chartName').textContent=S.symbol+' · M1';await startGlobalScanner();status('Preparando gráfico '+S.symbol+'…');S.raw=await history(S.symbol);S.markets.set(S.symbol,{name:S.symbols.find(x=>x.code===S.symbol)?.name||S.symbol,candles:S.raw});if(!S.raw.length)throw Error('No hay velas M1 disponibles');restoreOpenSignals(S.symbol,S.raw);const cfg=config(S.symbol);$('tpPoints').value=cfg.tp;$('slPoints').value=cfg.sl;$('settingsStatus').textContent='Configuración de '+S.symbol;const span=S.raw.at(-1).time-S.raw[0].time;if(S.raw.length<COUNT)console.warn('Deriv devolvió '+S.raw.length+' de '+COUNT+' velas solicitadas');S.trades=backtest48h(S.raw);initCharts();drawChart();renderHistory();await subscribeLive();await startGlobalScanner();status('Deriv conectada · escáner global activo · '+S.symbol,true)}
async function recalc(){saveConfig();S.trades=backtest48h(S.raw);drawChart();renderHistory()}
$('symbol').addEventListener('change',()=>loadCurrent().catch(e=>status(e.message)));$('reload').addEventListener('click',()=>loadCurrent().catch(e=>status(e.message)));$('applyRisk').addEventListener('click',recalc);
async function start(){restoreLiveHistory();try{await connect();await loadSymbols();const saved=localStorage.getItem('botder-current-symbol');if(saved&&S.symbols.some(x=>x.code===saved))$('symbol').value=saved;await loadCurrent()}catch(e){status(e.message);scheduleReconnect()}}
start();
})();