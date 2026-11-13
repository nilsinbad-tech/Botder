(()=>{'use strict';
const $=id=>document.getElementById(id),API='wss://api.derivws.com/trading/v1/options/ws/public',STORE='botder-binary-zigzag-5s-v1',EXPIRY=120000,ENTRY_WINDOW=10000;
const CFG={depth:3,deviation:5,separation:3};
const DB_NAME='botder-candles-cache-v1',DB_STORE='instruments';let dbPromise=null;
function openCache(){if(dbPromise)return dbPromise;dbPromise=new Promise((resolve,reject)=>{if(!('indexedDB'in window))return reject(Error('Este navegador no permite guardar el histórico'));const q=indexedDB.open(DB_NAME,1);q.onupgradeneeded=()=>{if(!q.result.objectStoreNames.contains(DB_STORE))q.result.createObjectStore(DB_STORE,{keyPath:'symbol'})};q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error||Error('No se pudo abrir la caché'))});return dbPromise}
async function cacheGet(symbol){const db=await openCache();return new Promise((resolve,reject)=>{const q=db.transaction(DB_STORE,'readonly').objectStore(DB_STORE).get(symbol);q.onsuccess=()=>resolve(q.result||null);q.onerror=()=>reject(q.error)})}
async function cachePut(symbol,raw,chartBars){const db=await openCache();return new Promise((resolve,reject)=>{const q=db.transaction(DB_STORE,'readwrite').objectStore(DB_STORE).put({symbol,raw,chartBars,savedAt:Date.now(),version:1});q.onsuccess=()=>resolve(true);q.onerror=()=>reject(q.error)})}
async function getInstrumentHistory(symbol,force=false){if(!force){try{const cached=await cacheGet(symbol);if(cached&&cached.version===1&&Array.isArray(cached.raw)&&cached.raw.length&&Array.isArray(cached.chartBars)&&cached.chartBars.length)return cached}catch(e){console.warn('Caché BOTDER',symbol,e)}}status('Descargando histórico del instrumento seleccionado · '+symbol);const [raw,chartBars]=await Promise.all([history(symbol),chartHistory(symbol)]);await cachePut(symbol,raw,chartBars);return{symbol,raw,chartBars,savedAt:Date.now(),version:1}}
async function preloadAllInstruments(){let ready=0,failed=[];for(const item of S.symbols){try{const c=await getInstrumentHistory(item.code,false);ready++;status('Histórico guardado · '+ready+'/'+S.symbols.length+' instrumentos · '+item.name,true)}catch(e){failed.push(item.name+': '+e.message);console.error('Histórico '+item.code,e)}}$('chartTitle').textContent='Histórico preparado · '+ready+'/'+S.symbols.length+' instrumentos';if(failed.length)status('Histórico guardado '+ready+'/'+S.symbols.length+' · fallaron '+failed.length+'; '+failed[0]);else status('Los '+ready+' instrumentos están guardados en el dispositivo',true)}

try{const saved=JSON.parse(localStorage.getItem(STORE+'-config')||'null');if(saved?.strategy==='zigzag-m1-original')Object.assign(CFG,saved)}catch{}
const FOREX=['frxEURUSD','frxGBPUSD','frxUSDJPY','frxAUDUSD','frxUSDCAD','frxUSDCHF','frxNZDUSD','frxEURJPY','frxGBPJPY','frxEURGBP'];
const EXTRA_ASSETS=[{key:'BTCUSD',label:'BTC/USD',match:x=>/^(cry)?BTCUSD$/i.test(x.symbol||x.underlying_symbol||'')||(/bitcoin/i.test((x.display_name||'')+' '+(x.underlying_symbol_name||''))&&/usd/i.test((x.display_name||'')+' '+(x.underlying_symbol_name||'')))},{key:'STONKS',label:'STONKS',match:x=>/stonks/i.test([x.symbol,x.underlying_symbol,x.display_name,x.underlying_symbol_name].filter(Boolean).join(' '))}];
const S={ws:null,req:0,pending:new Map(),symbols:[],symbol:'',raw:[],chartBars:[],price:null,chart:null,candleSeries:null,ema9:null,ema20:null,ema50:null,markerApi:null,visualLines:[],obOverlay:null,signal:null,signalTimer:null,trade:null,ops:[],backtestTimer:null,chartCountdown:null,lastPivotKey:'',lastAlertKey:'',lastPrealertSlot:-1,subId:null,heartbeat:null,reconnectTimer:null,starting:null,ticks:[],tradeTimer:null};
const norm=x=>String(x||'').toLowerCase().replace(/[^a-z0-9]/g,'');
function status(t,ok=false){$('connection').textContent=t;$('connection').style.color=ok?'#20d18b':'#ffb95c'}
function send(p){return new Promise((resolve,reject)=>{if(!S.ws||S.ws.readyState!==1)return reject(Error('Deriv desconectada'));const id=++S.req,t=setTimeout(()=>{S.pending.delete(id);reject(Error('Tiempo de espera de Deriv'))},15000);S.pending.set(id,{resolve:x=>{clearTimeout(t);resolve(x)},reject:e=>{clearTimeout(t);reject(e)}});S.ws.send(JSON.stringify({...p,req_id:id}))})}
function scheduleReconnect(){if(S.reconnectTimer)return;S.reconnectTimer=setTimeout(()=>{S.reconnectTimer=null;if(document.visibilityState==='hidden')return;if(S.starting){scheduleReconnect();return}start()},4000)}
function connect(){return new Promise((resolve,reject)=>{let settled=false,opened=false;const ws=new WebSocket(API);S.ws=ws;const timer=setTimeout(()=>{if(!opened){try{ws.close()}catch{}if(!settled){settled=true;reject(Error('Tiempo de conexión agotado'))}}},12000);ws.onopen=()=>{opened=true;clearTimeout(timer);status('Socket abierto · verificando respuesta de Deriv…');if(S.heartbeat)clearInterval(S.heartbeat);S.heartbeat=setInterval(()=>{if(ws!==S.ws||ws.readyState!==1)return;send({ping:1}).catch(()=>{status('Sin respuesta de Deriv · reconectando…');try{ws.close()}catch{}})},25000);if(!settled){settled=true;resolve()}};ws.onerror=()=>{if(!opened&&!settled){clearTimeout(timer);settled=true;reject(Error('No se pudo abrir el WebSocket de Deriv'))}};ws.onclose=()=>{clearTimeout(timer);if(ws!==S.ws)return;S.ws=null;if(S.heartbeat){clearInterval(S.heartbeat);S.heartbeat=null}status('Deriv desconectada · reconectando…');for(const p of S.pending.values())p.reject(Error('Conexión cerrada'));S.pending.clear();if(!settled){settled=true;reject(Error('Conexión cerrada antes de completar el inicio'))}else scheduleReconnect()};ws.onmessage=e=>{let m;try{m=JSON.parse(e.data)}catch{return}if(m.req_id&&S.pending.has(m.req_id)){const p=S.pending.get(m.req_id);S.pending.delete(m.req_id);m.error?p.reject(Error(m.error.message)):p.resolve(m);return}if(m.tick)onTick(m.tick)}})}
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&(!S.ws||S.ws.readyState!==1))scheduleReconnect()});\nasync function loadSymbols(){const r=await send({active_symbols:'brief'}),active=(r.active_symbols||[]).filter(x=>!Number(x.is_trading_suspended));const list=[];for(const code of FOREX){const x=active.find(a=>(a.underlying_symbol||a.symbol)===code);if(x)list.push({code:x.underlying_symbol||x.symbol,name:x.display_name||x.underlying_symbol_name||code})}for(const asset of EXTRA_ASSETS){const x=active.find(asset.match);if(x&&!list.some(y=>y.code===(x.underlying_symbol||x.symbol)))list.push({code:x.underlying_symbol||x.symbol,name:asset.label})}S.symbols=list;$('symbol').innerHTML=list.map(x=>'<option value="'+x.code+'">'+x.name+'</option>').join('');if(!list.length)throw Error('Deriv no devolvió instrumentos disponibles');$('symbol').value=list[0].code;const missing=EXTRA_ASSETS.filter(a=>!active.some(a.match)).map(a=>a.label);if(missing.length)status('Deriv no ofrece: '+missing.join(', ')+' · disponibles: '+list.length,true)}
async function history(symbol){
 // La API nueva limita cada respuesta a 1000 ticks. Paginar hasta cubrir 24h.
 const cutoff=Math.floor(Date.now()/1000)-86400,byBucket=new Map();let end=Math.floor(Date.now()/1000),pages=0,totalTicks=0,lastOldest=Infinity;
 while(end>cutoff&&pages<1000){
  status('Descargando 24h de histórico 5s · '+symbol+' · página '+(pages+1));
  const r=await send({ticks_history:symbol,start:cutoff,end:String(end),count:1000,style:'ticks'});
  const h=r.history||{},times=h.times||[],prices=h.prices||[];
  if(!times.length||!prices.length)break;
  const rows=times.map((t,i)=>({time:Number(t),price:Number(prices[i])})).filter(x=>Number.isFinite(x.time)&&Number.isFinite(x.price)).sort((x,y)=>x.time-y.time);
  if(!rows.length)break;
  totalTicks+=rows.length;
  for(const tick of rows){
   if(tick.time<cutoff||tick.time>end)continue;
   const time=Math.floor(tick.time/5)*5;let bar=byBucket.get(time);
   if(!bar)byBucket.set(time,{time,open:tick.price,high:tick.price,low:tick.price,close:tick.price,ticks:1});
   else{bar.high=Math.max(bar.high,tick.price);bar.low=Math.min(bar.low,tick.price);bar.close=tick.price;bar.ticks++}
  }
  const oldest=rows[0].time;
  if(oldest<=cutoff)break;
  if(oldest>=lastOldest)throw Error('Deriv repitió una página del histórico 5s. Descarga detenida.');
  lastOldest=oldest;end=Math.floor(oldest)-1;
 }
 const lastClosed=Math.floor(Date.now()/5)*5-5,closed=[...byBucket.values()].filter(x=>x.time>=cutoff&&x.time<=lastClosed).sort((x,y)=>x.time-y.time);
 if(!closed.length)throw Error('Deriv no entregó ticks históricos para '+symbol+'.');
 const hours=(closed.length*5/3600).toFixed(2);
 if(closed[0].time>cutoff+300)throw Error('Histórico incompleto: '+hours+' horas 5s recuperadas en '+pages+' páginas ('+totalTicks+' ticks). No se iniciará el análisis sin las 24h.');
 return closed;
}
async function chartHistory(symbol){
 const cutoff=Math.floor(Date.now()/1000)-86400;let end='latest',all=new Map(),pages=0,lastOldest=Infinity;
 while(pages<5){
  status('Descargando 1,440 velas M1 · '+symbol+' · página '+(pages+1));
  const r=await send({ticks_history:symbol,start:cutoff,end:String(end),count:1000,style:'candles',granularity:60});
  const rows=(r.candles||[]).map(x=>({time:+x.epoch,open:+x.open,high:+x.high,low:+x.low,close:+x.close})).filter(x=>Number.isFinite(x.time)&&Number.isFinite(x.open)&&Number.isFinite(x.high)&&Number.isFinite(x.low)&&Number.isFinite(x.close)).sort((x,y)=>x.time-y.time);
  if(!rows.length)break;
  for(const x of rows)if(x.time>=cutoff)all.set(x.time,x);
  const oldest=rows[0].time;
  if(oldest<=cutoff)break;
  if(oldest>=lastOldest)throw Error('Deriv repitió una página de velas M1.');
  lastOldest=oldest;end=String(Math.floor(oldest)-1);pages++;
 }
 const out=[...all.values()].sort((x,y)=>x.time-y.time);
 if(out.length<100)throw Error('Histórico M1 insuficiente: Deriv devolvió '+out.length+' velas');
 if(out[0].time>cutoff+120)throw Error('Gráfico M1 incompleto: solo '+out.length+' velas en 24h. No se mostrará como histórico completo.');
 return out.slice(-1440);
}
function aggregateMinutes(c,minutes){
 const step=minutes*60,map=new Map();
 for(const b of c){const t=Math.floor(b.time/step)*step;let x=map.get(t);if(!x){x={time:t,open:b.open,high:b.high,low:b.low,close:b.close,count:0};map.set(t,x)}x.high=Math.max(x.high,b.high);x.low=Math.min(x.low,b.low);x.close=b.close;x.count++}
 return [...map.values()];
}
function aggregate1m(c){const map=new Map();for(const b of c){if(!Number.isFinite(b.time)||!Number.isFinite(b.open)||!Number.isFinite(b.high)||!Number.isFinite(b.low)||!Number.isFinite(b.close))continue;const t=Math.floor(b.time/60)*60;let x=map.get(t);if(!x){x={time:t,open:b.open,high:b.high,low:b.low,close:b.close,count:0,firstTime:b.time,lastTime:b.time};map.set(t,x)}if(b.time===x.lastTime&&x.count>0)continue;x.high=Math.max(x.high,b.high);x.low=Math.min(x.low,b.low);x.close=b.close;x.count++;x.lastTime=b.time}return [...map.values()].filter(x=>x.count===12&&x.firstTime===x.time&&x.lastTime===x.time+55).map(({firstTime,lastTime,...x})=>x)}
function partialMinute(c,minute){const a=c.filter(x=>x.time>=minute&&x.time<minute+50);if(a.length!==10||a[0].time!==minute||a.at(-1).time!==minute+45)return null;return{time:minute,open:a[0].open,high:Math.max(...a.map(x=>x.high)),low:Math.min(...a.map(x=>x.low)),close:a.at(-1).close}}
function aggregate20(c){const map=new Map();for(const b of c){if(!Number.isFinite(b.time)||!Number.isFinite(b.open)||!Number.isFinite(b.high)||!Number.isFinite(b.low)||!Number.isFinite(b.close))continue;const t=Math.floor(b.time/20)*20;let x=map.get(t);if(!x){x={time:t,open:b.open,high:b.high,low:b.low,close:b.close,count:0,firstTime:b.time,lastTime:b.time};map.set(t,x)}if(b.time===x.lastTime&&x.count>0)continue;x.high=Math.max(x.high,b.high);x.low=Math.min(x.low,b.low);x.close=b.close;x.count++;x.lastTime=b.time}return [...map.values()].filter(x=>x.count===4&&x.firstTime===x.time&&x.lastTime===x.time+15).map(({firstTime,lastTime,...x})=>x)}
function partial20(c,slot){const a=c.filter(x=>x.time>=slot&&x.time<slot+15);if(a.length!==3||a[0].time!==slot||a.at(-1).time!==slot+10)return null;return{time:slot,open:a[0].open,high:Math.max(...a.map(x=>x.high)),low:Math.min(...a.map(x=>x.low)),close:a.at(-1).close}}
function updateVisuals(){
 if(!S.candleSeries||!S.chartBars.length)return;
 const bars=S.chartBars,markers=[],now=Date.now()/1000,cutoff=now-86400;
 const m10=bars,pts=zigzag(m10);
 // Solo pivotes recientes y confirmados: evita llenar el gráfico de flechas.
 const pivots=pts.filter(p=>p.confirmed<m10.length&&p.time>=cutoff).slice(-6);
 for(const p of pivots)markers.push({time:p.time,position:p.type==='LOW'?'belowBar':'aboveBar',color:p.type==='LOW'?'#20d18b':'#ff5968',shape:p.type==='LOW'?'arrowUp':'arrowDown',text:''});
 for(const op of S.ops){if(op.symbol!==S.symbol||Date.now()-op.entryTime>86400000)continue;const t=Math.floor((op.entryTime/1000)/60)*60;markers.push({time:t,position:op.side==='BUY'?'belowBar':'aboveBar',color:op.side==='BUY'?'#20d18b':'#ff5968',shape:'circle',text:op.side==='BUY'?'CALL':'PUT'});if(op.exitTime){const xt=Math.floor((op.exitTime/1000)/60)*60;markers.push({time:xt,position:op.side==='BUY'?'aboveBar':'belowBar',color:op.result==='WIN'?'#20d18b':op.result==='LOSS'?'#ff5968':'#f5c451',shape:'square',text:op.result==='WIN'?'W':op.result==='LOSS'?'L':'='});}}
 if(S.signal){const t=Math.floor(S.signal.pivot.time/60)*60;markers.push({time:t,position:S.signal.side==='BUY'?'belowBar':'aboveBar',color:'#f5c451',shape:'arrow',text:S.signal.side==='BUY'?'PREPARAR CALL':'PREPARAR PUT'});}
 if(S.trade){const t=Math.floor((S.trade.entryTime/1000)/60)*60;markers.push({time:t,position:S.trade.side==='BUY'?'belowBar':'aboveBar',color:'#f5c451',shape:'circle',text:S.trade.side==='BUY'?'CALL ACTIVO':'PUT ACTIVO'});}
 markers.sort((a,b)=>a.time-b.time);if(S.markerApi)S.markerApi.setMarkers(markers);
 S.visualLines.forEach(x=>{try{S.candleSeries.removePriceLine(x)}catch{}});S.visualLines=[];
 // No mostrar etiquetas en la escala de precios: se superponían unas con otras.
 const add=(price,title,color,style=2)=>{if(Number.isFinite(price))S.visualLines.push(S.candleSeries.createPriceLine({price,title,color,lineWidth:1,lineStyle:style,axisLabelVisible:false,title: title}))};
 const lows=pivots.filter(p=>p.type==='LOW'),highs=pivots.filter(p=>p.type==='HIGH');
 if(lows.length)add(lows.at(-1).price,'Soporte M1', '#20d18b',2);
 if(highs.length)add(highs.at(-1).price,'Resistencia M1','#ff5968',2);
 drawOrderBlocks();
}

function findOrderBlocks(bars){const m5=aggregateMinutes(bars,5),found=[],start=Math.max(5,m5.length-180);for(let i=start;i<m5.length;i++){const impulse=m5[i],prior=m5.slice(i-5,i),breakHigh=Math.max(...prior.map(x=>x.high)),breakLow=Math.min(...prior.map(x=>x.low));let side=null,ob=null;if(impulse.close>impulse.open&&impulse.close>breakHigh){side='buy';for(let j=i-1;j>=Math.max(0,i-4);j--)if(m5[j].close<m5[j].open){ob=m5[j];break}}else if(impulse.close<impulse.open&&impulse.close<breakLow){side='sell';for(let j=i-1;j>=Math.max(0,i-4);j--)if(m5[j].close>m5[j].open){ob=m5[j];break}}if(!side||!ob)continue;const top=side==='buy'?ob.open:ob.high,bottom=side==='buy'?ob.low:ob.open;if(!(top>bottom))continue;if(m5.slice(i+1).some(x=>side==='buy'?x.close<bottom:x.close>top))continue;const zone={side,time:ob.time,top,bottom};const duplicate=found.some(z=>z.side===side&&Math.min(z.top,top)>Math.max(z.bottom,bottom)&&Math.abs(z.time-zone.time)<1800);if(!duplicate)found.push(zone)}return ['buy','sell'].flatMap(side=>found.filter(z=>z.side===side).slice(-2)).sort((a,b)=>a.time-b.time)}
function drawOrderBlocks(){if(!S.chart||!S.candleSeries||!S.obOverlay||!S.chartBars.length)return;const scale=S.chart.timeScale(),last=S.chartBars.at(-1);S.obOverlay.replaceChildren();for(const z of findOrderBlocks(S.chartBars)){const x1=scale.timeToCoordinate(z.time),x2=S.obOverlay.clientWidth,y1=S.candleSeries.priceToCoordinate(z.top),y2=S.candleSeries.priceToCoordinate(z.bottom);if(x1==null||x2==null||y1==null||y2==null)continue;const left=Math.max(0,Math.min(x1,x2)),right=Math.min(S.obOverlay.clientWidth,Math.max(x1,x2)),top=Math.max(0,Math.min(y1,y2)),bottom=Math.min(S.obOverlay.clientHeight,Math.max(y1,y2));if(right-left<8||bottom-top<3||left>S.obOverlay.clientWidth||right<0||top>S.obOverlay.clientHeight||bottom<0)continue;const el=document.createElement('div');el.className='si-ob '+z.side;el.style.left=left+'px';el.style.top=top+'px';el.style.width=(right-left)+'px';el.style.height=(bottom-top)+'px';const tag=document.createElement('span');tag.textContent=z.side==='buy'?'OB +':'OB -';el.appendChild(tag);S.obOverlay.appendChild(el)}}
function ema(c,p){const out=Array(c.length).fill(null),k=2/(p+1);let v=null;c.forEach((x,i)=>{v=v===null?x.close:x.close*k+v*(1-k);out[i]=v});return out}
function zigzag(c,depth=CFG.depth,sep=CFG.separation,deviation=CFG.deviation){const pts=[];for(let i=depth;i<c.length-depth;i++){let hi=true,lo=true;for(let j=1;j<=depth;j++){if(c[i].high<c[i-j].high||c[i].high<c[i+j].high)hi=false;if(c[i].low>c[i-j].low||c[i].low>c[i+j].low)lo=false}if(!hi&&!lo)continue;const p={index:i,time:c[i].time,price:hi?c[i].high:c[i].low,type:hi?'HIGH':'LOW',confirmed:i+depth};const last=pts.at(-1);if(!last||last.type!==p.type){const move=last?Math.abs(p.price-last.price):Infinity,minMove=last?Math.abs(last.price)*(deviation/10000):0;if(!last||(i-last.index>=sep&&move>=minMove))pts.push(p)}else if((p.type==='HIGH'&&p.price>last.price)||(p.type==='LOW'&&p.price<last.price))pts[pts.length-1]=p}return pts}
function setSignal(s){
 if(S.signal||S.trade)return;
 const key=S.symbol+'|'+s.side+'|'+s.pivot.time;
 if(key===S.lastPivotKey)return;
 S.lastPivotKey=key;
 S.signal={...s,key,created:s.prealertAt,entryAt:(s.signalTime+20)*1000,state:'PREALERT'};
 $('signal').className='binary-signal '+(s.side==='BUY'?'buy':'sell');
 $('signalTitle').textContent=s.side==='BUY'?'🟢 POSIBLE COMPRA · ZIGZAG M20':'🔴 POSIBLE VENTA · ZIGZAG M20';
 $('signalInfo').textContent='SEÑAL VIGENTE · precio referencial '+fmt(s.partial.close)+' · entrada prevista al abrir la próxima vela de 20 segundos. Se confirma o cancela en ese momento.';
 $('signalPrice').textContent=fmt(s.partial.close);
 $('tradeState').textContent='VIGENTE · PREAVISO 10s';
 if(S.signalTimer)clearInterval(S.signalTimer);
 const update=()=>{if(!S.signal)return;const left=Math.max(0,S.signal.entryAt-Date.now());$('signalCountdown').textContent=(left/1000).toFixed(1)+' s';};
 update();S.signalTimer=setInterval(update,100);updateVisuals();
}
function cancelPendingSignal(message){
 if(S.signalTimer)clearInterval(S.signalTimer);S.signalTimer=null;S.signal=null;
 $('signalTitle').textContent='SEÑAL CANCELADA';$('signalInfo').textContent=message;$('signalCountdown').textContent='—';$('tradeState').textContent='CANCELADA';
}
function prepareSignal(epoch){
 if(S.trade||S.signal)return;
 const slot=Math.floor(epoch/20)*20,second=epoch-slot;
 if(second<10||second>12||S.lastPrealertSlot===slot)return;
 const complete=aggregate20(S.raw).filter(x=>x.time<slot);
 if(complete.length<CFG.depth*2+4)return;
 const partial=partial20(S.raw,slot);if(!partial)return;
 const pivot=zigzag(complete).at(-1);
 if(!pivot||pivot.confirmed!==complete.length-1)return;
 const side=pivot.type==='LOW'&&partial.close>partial.open?'BUY':pivot.type==='HIGH'&&partial.close<partial.open?'SELL':null;
 if(!side)return;
 S.lastPrealertSlot=slot;
 setSignal({side,pivot,partial,signalTime:slot,prealertAt:epoch*1000});
}
function activatePendingEntry(price,epoch){
 const s=S.signal;if(!s||epoch*1000<s.entryAt)return;
 const late=epoch*1000-s.entryAt,last=aggregate20(S.raw).find(x=>x.time===s.signalTime);
 if(late>5000||!last){cancelPendingSignal('Se canceló: no llegó a tiempo la vela completa de 20 segundos.');return}
 const valid=s.side==='BUY'?last.close>last.open&&last.low>=s.pivot.price:last.close<last.open&&last.high<=s.pivot.price;
 if(!valid){cancelPendingSignal('Señal CANCELADA: la vela de 20 segundos perdió dirección o rompió el pivote.');return}
 startAutomaticTrade(price,epoch);
}
function onTick(t){
 if(t.symbol&&t.symbol!==S.symbol)return;
 const price=Number(t.quote),epoch=Number(t.epoch);if(!Number.isFinite(price)||!Number.isFinite(epoch))return;
 S.price=price;$('price').textContent=fmt(price);
 const bucket=Math.floor(epoch/5)*5,last=S.raw.at(-1);let closed=false;
 if(!last){S.raw.push({time:bucket,open:price,high:price,low:price,close:price})}
 else if(last.time===bucket){last.high=Math.max(last.high,price);last.low=Math.min(last.low,price);last.close=price}
 else if(bucket>last.time){S.raw.push({time:bucket,open:last.close,high:Math.max(last.close,price),low:Math.min(last.close,price),close:price});if(S.raw.length>22000)S.raw.shift();closed=true}else return;
 try{
  const minute=Math.floor(epoch/60)*60,lastBar=S.chartBars.at(-1);
  if(lastBar&&lastBar.time===minute){lastBar.high=Math.max(lastBar.high,price);lastBar.low=Math.min(lastBar.low,price);lastBar.close=price}
  else if(!lastBar||minute>lastBar.time){S.chartBars.push({time:minute,open:lastBar?lastBar.close:price,high:Math.max(lastBar?lastBar.close:price,price),low:Math.min(lastBar?lastBar.close:price,price),close:price});if(S.chartBars.length>1440)S.chartBars.shift()}
  const bars=S.chartBars;if(bars.length){const b=bars.at(-1),a=ema(bars,9),e=ema(bars,20),d=ema(bars,50),i=bars.length-1;S.candleSeries.update(b);S.ema9.update({time:b.time,value:a[i]});S.ema20.update({time:b.time,value:e[i]});S.ema50.update({time:b.time,value:d[i]});}
  $('trend').textContent='ZIGZAG M20';$('chartTitle').textContent=S.symbol+' · M1 · 24H · '+bars.length+' velas';
  if(S.signal)activatePendingEntry(price,epoch);
  if(!S.signal&&!S.trade)prepareSignal(epoch);
  if(closed&&bucket%60===0){updateVisuals();runBacktest();cachePut(S.symbol,S.raw,S.chartBars).catch(e=>console.warn('No se pudo guardar el histórico',e))}
  if(S.trade&&epoch*1000>=S.trade.deadline)finishTrade(price,epoch*1000);
  updateChartCountdown();
 }catch(e){console.error('Error procesando tick',e)}
}
function fmt(v){if(!Number.isFinite(Number(v)))return'—';return Number(v).toPrecision(8).replace(/(\.\d*?)0+$/,'$1').replace(/\.$/,'')}
function buildPartialMap(raw){const map=new Map(),groups=new Map();for(const b of raw){const slot=Math.floor(b.time/20)*20;if(b.time<slot||b.time>=slot+15)continue;let a=groups.get(slot);if(!a)groups.set(slot,a=[]);a.push(b)}for(const [slot,a] of groups){a.sort((x,y)=>x.time-y.time);if(a.length===3&&a[0].time===slot&&a[1].time===slot+5&&a[2].time===slot+10)map.set(slot,{time:slot,open:a[0].open,high:Math.max(...a.map(x=>x.high)),low:Math.min(...a.map(x=>x.low)),close:a[2].close})}return map}
function simulateZigzagConfig(c,partialMap,p){const pts=[],trades=[];let busyUntil=-1;for(let i=Math.max(p.depth*2+2, p.depth+1);i<c.length-6;i++){const j=i-1-p.depth;if(j>=p.depth){const b=c[j];let hi=true,lo=true;for(let k=1;k<=p.depth;k++){if(b.high<c[j-k].high||b.high<c[j+k].high)hi=false;if(b.low>c[j-k].low||b.low>c[j+k].low)lo=false}if(hi||lo){const q={index:j,time:b.time,price:hi?b.high:b.low,type:hi?'HIGH':'LOW'},last=pts.at(-1);if(!last||last.type!==q.type){const move=last?Math.abs(q.price-last.price):Infinity,minMove=last?Math.abs(last.price)*(p.deviation/10000):0;if(!last||(j-last.index>=p.separation&&move>=minMove))pts.push(q)}else if((q.type==='HIGH'&&q.price>last.price)||(q.type==='LOW'&&q.price<last.price))pts[pts.length-1]=q}}
if(i<=busyUntil)continue;const pivot=pts.at(-1),partial=partialMap.get(c[i].time);if(!pivot||!partial)continue;const side=pivot.type==='LOW'&&partial.close>partial.open?'BUY':pivot.type==='HIGH'&&partial.close<partial.open?'SELL':null;if(!side)continue;const valid=side==='BUY'?c[i].close>c[i].open&&c[i].low>=pivot.price:c[i].close<c[i].open&&c[i].high<=pivot.price;if(!valid)continue;const entryIndex=i+1,exitIndex=i+6,entry=c[entryIndex].open,exit=c[exitIndex].close,result=side==='BUY'?(exit>entry?'WIN':exit<entry?'LOSS':'EMPATE'):(exit<entry?'WIN':exit>entry?'LOSS':'EMPATE');trades.push({result,side,entryTime:c[entryIndex].time});busyUntil=exitIndex}return trades}
async function optimizeZigzag(){const raw=S.raw.slice(),c=aggregate20(raw);if(c.length<500){$('optimizerResult').textContent='Se necesitan más velas M20 para probar 500 configuraciones con fiabilidad.';return}const partialMap=buildPartialMap(raw),configs=[];for(let depth=2;depth<=11;depth++)for(let deviation=1;deviation<=10;deviation++)for(let separation=2;separation<=6;separation++)configs.push({depth,deviation,separation});let best=null,qualified=0;for(let n=0;n<configs.length;n++){const p=configs[n],trades=simulateZigzagConfig(c,partialMap,p),wins=trades.filter(x=>x.result==='WIN').length,losses=trades.filter(x=>x.result==='LOSS').length,decided=wins+losses,cut=Math.floor(trades.length*.7),test=trades.slice(cut),tw=test.filter(x=>x.result==='WIN').length,tl=test.filter(x=>x.result==='LOSS').length,tested=tw+tl,rate=decided?100*wins/decided:0,testRate=tested?100*tw/tested:0;if(trades.length>=101&&tested>=30){qualified++;const candidate={...p,total:trades.length,wins,losses,draws:trades.length-decided,rate,tested,testRate,score:testRate*10000+Math.min(tested,1000)};if(!best||candidate.score>best.score||(candidate.score===best.score&&candidate.total>best.total))best=candidate}if((n+1)%10===0){$('optimizerProgress').textContent=(n+1)+' / 500 configuraciones';$('optimizerResult').textContent='Probando parámetros ZigZag · '+(n+1)+' de 500';await new Promise(resolve=>setTimeout(resolve,0))}}if(!best){$('optimizerProgress').textContent='500 / 500 configuraciones';$('optimizerResult').textContent='No se encontró una configuración con al menos 101 operaciones y 20 operaciones de validación fuera de muestra. Amplía el histórico o prueba otro instrumento; no se aplicó una configuración engañosa.';return}const manual=localStorage.getItem(STORE+'-manual-config')==='1';if(!manual){Object.assign(CFG,{depth:best.depth,deviation:best.deviation,separation:best.separation});applyConfig();localStorage.setItem(STORE+'-config',JSON.stringify({...CFG,strategy:'zigzag-m1-original'}));$('configStatus').textContent='Configuración recomendada automáticamente · '+CFG.depth+'-'+CFG.deviation+'-'+CFG.separation;}else{$('configStatus').textContent='Tu configuración manual sigue activa · '+CFG.depth+'-'+CFG.deviation+'-'+CFG.separation+' (la recomendación no la reemplazó).'} $('optimizerProgress').textContent='500 / 500 · '+qualified+' configuraciones con muestra suficiente';$('optimizerResult').textContent='MEJOR CONFIGURACIÓN · Depth '+best.depth+' · Deviation '+best.deviation+' · Backstep '+best.separation+' · '+best.total+' operaciones · '+best.wins+' WIN · '+best.losses+' LOSS · '+best.draws+' EMPATE · efectividad total '+best.rate.toFixed(1)+'% · validación fuera de muestra '+best.testRate.toFixed(1)+'% ('+best.tested+' operaciones). '+(best.testRate>=80?'Superó el objetivo del 80% en validación histórica.':'No alcanzó el objetivo del 80% en validación; no se garantiza ese rendimiento.');runBacktest()}
function runBacktest(){
 const c=aggregate20(S.raw);if(c.length<CFG.depth*2+10){$('backtestResult').textContent='Histórico de 20 segundos insuficiente para confirmar pivotes ZigZag.';return}
 const trades=[];let busyUntil=-1,lastKey='';
 for(let i=CFG.depth*2+2;i<c.length-6;i++){
  if(i<=busyUntil)continue;
  const previous=c.slice(0,i),pivot=zigzag(previous).at(-1);
  if(!pivot||pivot.confirmed!==previous.length-1)continue;
  const partial=partial20(S.raw,c[i].time);if(!partial)continue;
  const side=pivot.type==='LOW'&&partial.close>partial.open?'BUY':pivot.type==='HIGH'&&partial.close<partial.open?'SELL':null;
  if(!side)continue;
  const finalValid=side==='BUY'?c[i].close>c[i].open&&c[i].low>=pivot.price:c[i].close<c[i].open&&c[i].high<=pivot.price;
  if(!finalValid)continue;
  const key=side+'|'+pivot.time+'|'+c[i].time;if(key===lastKey)continue;lastKey=key;
  const entryIndex=i+1,exitIndex=i+6;if(exitIndex>=c.length)continue;
  const entry=c[entryIndex].open,exit=c[exitIndex].close;
  const result=side==='BUY'?(exit>entry?'WIN':exit<entry?'LOSS':'EMPATE'):(exit<entry?'WIN':exit>entry?'LOSS':'EMPATE');
  const entryTime=c[entryIndex].time*1000,exitTime=(c[entryIndex].time+120)*1000;
  trades.push({id:'BT-'+S.symbol+'-'+entryTime,symbol:S.symbol,side,entry,entryTime,exit,exitTime,result,mode:'BACKTEST',pivotTime:pivot.time,signalTime:c[i].time+10});
  busyUntil=exitIndex;
 }
 const previous=S.ops.filter(x=>!(x.mode==='BACKTEST'&&x.symbol===S.symbol));
 S.ops=[...trades,...previous].sort((a,b)=>b.entryTime-a.entryTime).slice(0,2000);
 saveOps();renderOps();updateVisuals();
 const wins=trades.filter(x=>x.result==='WIN').length,losses=trades.filter(x=>x.result==='LOSS').length,draws=trades.filter(x=>x.result==='EMPATE').length,total=trades.length,rate=total?100*wins/total:0;
 $('backtestResult').textContent='BACKTEST M20 · ZigZag '+CFG.depth+'-'+CFG.deviation+'-'+CFG.separation+' · preaviso 10s · confirmación M20 · entrada en la siguiente vela · vencimiento 120s · '+c.length+' velas completas · WIN '+wins+' · LOSS '+losses+' · EMPATE '+draws+' · efectividad '+rate.toFixed(1)+'%.';
}
function loadOps(){try{const a=JSON.parse(localStorage.getItem(STORE+'-operations')||'[]');S.ops=Array.isArray(a)?a:[]}catch{S.ops=[]}renderOps()}
function saveOps(){localStorage.setItem(STORE+'-operations',JSON.stringify(S.ops.slice(0,2000)))}
function startAutomaticTrade(entryPrice,epoch){if(!S.signal||S.trade||!Number.isFinite(entryPrice))return;const s=S.signal;if(S.signalTimer)clearInterval(S.signalTimer);S.signalTimer=null;S.signal=null;const entryTime=Number.isFinite(epoch)?epoch*1000:Date.now();S.trade={id:String(entryTime)+'-'+Math.random().toString(36).slice(2,7),symbol:S.symbol,side:s.side,entry:entryPrice,entryTime,deadline:entryTime+EXPIRY,pivotTime:s.pivot.time,result:'OPEN',mode:'SIMULATED'};S.ops.unshift({...S.trade});saveOps();$('tradeState').textContent=s.side==='BUY'?'CALL SIMULADO · ACTIVO':'PUT SIMULADO · ACTIVO';$('signalTitle').textContent=s.side==='BUY'?'CALL EN CURSO':'PUT EN CURSO';$('signalInfo').textContent='Entrada '+fmt(entryPrice)+' · vencimiento en 2 minutos · operación simulada, no enviada a Pocket Option.';$('signalCountdown').textContent='120.0 s';renderOps();updateVisuals();updateChartCountdown();if(S.tradeTimer)clearInterval(S.tradeTimer);let lastHistorySecond=-1;S.tradeTimer=setInterval(()=>{if(!S.trade)return;const left=Math.max(0,S.trade.deadline-Date.now()),sec=Math.ceil(left/1000);$('signalCountdown').textContent=(left/1000).toFixed(1)+' s';updateChartCountdown();if(sec!==lastHistorySecond){lastHistorySecond=sec;renderOps()}if(left<=0&&Number.isFinite(S.price))finishTrade(S.price,Date.now())},100)}
function finishTrade(exit,exitTime=Date.now()){if(!S.trade)return;const t=S.trade;const result=t.side==='BUY'?(exit>t.entry?'WIN':exit<t.entry?'LOSS':'EMPATE'):(exit<t.entry?'WIN':exit>t.entry?'LOSS':'EMPATE');const op=S.ops.find(x=>x.id===t.id);if(op){op.exit=exit;op.exitTime=exitTime;op.result=result}S.trade=null;updateChartCountdown();if(S.tradeTimer)clearInterval(S.tradeTimer);$('tradeState').textContent=result;$('signalTitle').textContent=result;$('signalInfo').textContent='Entrada '+fmt(t.entry)+' · cierre '+fmt(exit)+' · vencimiento 2 minutos';$('signalCountdown').textContent='—';saveOps();renderOps();updateVisuals()}
function updateChartCountdown(){const el=$('chartTradeCountdown');if(!el)return;if(!S.trade){el.hidden=true;el.textContent='';return}const left=Math.max(0,S.trade.deadline-Date.now());el.hidden=false;el.textContent='VENCIMIENTO '+(left/1000).toFixed(1)+' s';}
function renderOps(){
 const wins=S.ops.filter(x=>x.result==='WIN').length,loss=S.ops.filter(x=>x.result==='LOSS').length,draw=S.ops.filter(x=>x.result==='EMPATE').length,done=wins+loss+draw;
 $('wins').textContent=wins;$('losses').textContent=loss;$('draws').textContent=draw;$('rate').textContent=(done?100*wins/done:0).toFixed(1)+'%';$('total').textContent=S.ops.length;
 const countdown=x=>{if(x.result&&x.exitTime)return'FINALIZADA';const left=Math.max(0,Math.ceil(((x.entryTime||Date.now())+EXPIRY-Date.now())/1000));return String(Math.floor(left/60)).padStart(2,'0')+':'+String(left%60).padStart(2,'0')};
 $('history').innerHTML=S.ops.map(x=>'<div class="op-row '+(x.result==='WIN'?'win':x.result==='LOSS'?'loss':'')+'"><b class="op-star '+(x.side==='BUY'?'buy':'sell')+'">★</b><b>'+x.symbol+(x.mode==='BACKTEST'?' · BT':'')+'</b><b>'+(x.side==='BUY'?'CALL':'PUT')+'</b><span class="op-countdown">'+countdown(x)+'</span><strong>'+(x.result||'ACTIVA')+'</strong></div>').join('')||'Todavía no hay operaciones registradas.';
}
function initChart(){const L=LightweightCharts;$('chart').innerHTML='';S.obOverlay=document.createElement('div');S.obOverlay.className='v1-overlay';$('chart').appendChild(S.obOverlay);S.chart=L.createChart($('chart'),{autoSize:true,layout:{background:{type:'solid',color:'#0a1320'},textColor:'#aab9ca'},grid:{vertLines:{color:'#1b2a3d'},horzLines:{color:'#1b2a3d'}},timeScale:{timeVisible:true,secondsVisible:false,borderColor:'#34445a',rightOffset:4,barSpacing:3,minBarSpacing:0.5},rightPriceScale:{borderColor:'#34445a'},handleScroll:{mouseWheel:true,pressedMouseMove:true,horzTouchDrag:true},handleScale:{mouseWheel:true,pinch:true}});S.candleSeries=S.chart.addSeries(L.CandlestickSeries,{upColor:'#20d18b',downColor:'#ff5968',wickUpColor:'#20d18b',wickDownColor:'#ff5968',borderVisible:false});S.ema9=S.chart.addSeries(L.LineSeries,{color:'#318bff',lineWidth:2,title:'EMA 9'});S.ema20=S.chart.addSeries(L.LineSeries,{color:'#ff9d28',lineWidth:2,title:'EMA 20'});S.ema50=S.chart.addSeries(L.LineSeries,{color:'#b36bff',lineWidth:2,title:'EMA 50'});const bars=S.chartBars;S.candleSeries.setData(bars);const a=ema(bars,9),b=ema(bars,20),d=ema(bars,50);S.ema9.setData(bars.map((x,i)=>({time:x.time,value:a[i]})));S.ema20.setData(bars.map((x,i)=>({time:x.time,value:b[i]})));S.ema50.setData(bars.map((x,i)=>({time:x.time,value:d[i]})));if(L.createSeriesMarkers)S.markerApi=L.createSeriesMarkers(S.candleSeries,[]);updateVisuals();S.chart.timeScale().fitContent();S.chart.timeScale().subscribeVisibleLogicalRangeChange(drawOrderBlocks)}
async function subscribe(){if(S.subId){try{await send({forget:S.subId})}catch{}S.subId=null}const r=await send({ticks:S.symbol,subscribe:1});S.subId=r.subscription?.id||null;if(r.tick)onTick(r.tick)}
async function loadCurrent(force=false){if(S.trade){$('symbol').value=S.symbol;await subscribe();return}S.symbol=$('symbol').value;if(!S.symbol)return;const symbol=S.symbol;status('Abriendo gráfico · '+symbol);$('chartTitle').textContent=symbol+' · cargando velas M1';if(S.signalTimer)clearInterval(S.signalTimer);S.signalTimer=null;S.signal=null;S.lastPivotKey='';S.lastPrealertSlot=-1;$('signalTitle').textContent='ESPERANDO CONFIGURACIÓN';$('signalInfo').textContent='Gráfico M1 · confirmación ZigZag M20 · preaviso 10 segundos · CALL/PUT · vencimiento 2 minutos';$('signalCountdown').textContent='—';$('tradeState').textContent='SIN OPERACIÓN';let cached=null;if(!force){try{cached=await cacheGet(symbol)}catch(e){console.warn(e)}}if(S.symbol!==symbol)return;if(cached&&cached.version===1&&Array.isArray(cached.raw)&&cached.raw.length&&Array.isArray(cached.chartBars)&&cached.chartBars.length){S.raw=cached.raw;S.chartBars=cached.chartBars;initChart();runBacktest();await subscribe();status('EN VIVO · '+symbol+' · histórico guardado · '+S.chartBars.length+' velas M1',true);optimizeZigzag().catch(e=>{$('optimizerResult').textContent='No se pudo completar la optimización: '+e.message});return}S.raw=[];S.chartBars=await chartHistory(symbol);if(S.symbol!==symbol)return;$('chartTitle').textContent=symbol+' · M1 · '+S.chartBars.length+' velas · gráfico listo';initChart();await subscribe();status('GRÁFICO LISTO · cargando análisis en segundo plano',true);history(symbol).then(raw=>{if(S.symbol!==symbol)return;const live=S.raw.slice(),last=raw.at(-1);S.raw=[...raw,...live.filter(x=>!last||x.time>last.time)];runBacktest();cachePut(symbol,S.raw,S.chartBars).catch(e=>console.warn(e));status('EN VIVO · '+symbol+' · histórico y análisis listos',true);optimizeZigzag().catch(e=>{$('optimizerResult').textContent='No se pudo completar la optimización: '+e.message})}).catch(e=>{if(S.symbol===symbol)status('Gráfico en vivo · histórico de señales pendiente: '+e.message)})}
function start(){if(S.starting)return S.starting;S.starting=(async()=>{try{await connect();await loadSymbols();const saved=localStorage.getItem(STORE+'-symbol');if(saved&&S.symbols.some(x=>x.code===saved))$('symbol').value=saved;loadOps();await loadCurrent();if(S.ws&&S.ws.readyState===1)status('DERIV CONECTADA · DATOS EN VIVO',true)}catch(e){status('Deriv: '+e.message+' · reintentando…');scheduleReconnect()}})().finally(()=>{S.starting=null});return S.starting}
function applyConfig(){for(const k of Object.keys(CFG)){const el=$('cfg-'+k);if(el)el.value=CFG[k]}}
function saveConfig(){
 for(const k of Object.keys(CFG)){const el=$('cfg-'+k);if(el){const v=Number(el.value);if(Number.isFinite(v)&&v>0)CFG[k]=v}}
 localStorage.setItem(STORE+'-config',JSON.stringify({...CFG,strategy:'zigzag-m1-original'}));S.signal=null;runBacktest();
 $('configStatus').textContent='ZigZag actualizado · profundidad '+CFG.depth+' · desviación '+CFG.deviation+' · separación '+CFG.separation;
}
function applyManualConfig(){let next={};for(const k of Object.keys(CFG)){const el=$('cfg-'+k),v=el?Number(el.value):NaN;if(!Number.isFinite(v)||v<=0){$('configStatus').textContent='Escribe números válidos mayores que cero.';return}if(k==='depth'&&(!Number.isInteger(v)||v<2||v>20)){ $('configStatus').textContent='Depth debe ser un número entero entre 2 y 20.';return}if(k==='separation'&&(!Number.isInteger(v)||v<1||v>30)){ $('configStatus').textContent='Separación debe ser un número entero entre 1 y 30.';return}if(k==='deviation'&&v>100){$('configStatus').textContent='Deviation debe estar entre 0.1 y 100.';return}next[k]=v}Object.assign(CFG,next);localStorage.setItem(STORE+'-config',JSON.stringify({...CFG,strategy:'zigzag-m1-original'}));localStorage.setItem(STORE+'-manual-config','1');S.signal=null;runBacktest();$('configStatus').textContent='CONFIGURACIÓN MANUAL APLICADA · Depth '+CFG.depth+' · Deviation '+CFG.deviation+' · Separación '+CFG.separation;}\n$('applyZigzag')?.addEventListener('click',applyManualConfig);applyConfig();
$('symbol').addEventListener('change',()=>{localStorage.setItem(STORE+'-symbol',$('symbol').value);loadCurrent().catch(e=>status(e.message))});$('reload').addEventListener('click',()=>loadCurrent(true).catch(e=>status(e.message)));start();
})();