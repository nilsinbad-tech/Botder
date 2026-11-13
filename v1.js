(()=>{'use strict';
const $=id=>document.getElementById(id),API='wss://api.derivws.com/trading/v1/options/ws/public',STORE='botder-binary-zigzag-5s-v1',DEPTH=3,SEPARATION=3,EXPIRY=120000,ENTRY_WINDOW=10000;
const FOREX=['frxEURUSD','frxGBPUSD','frxUSDJPY','frxAUDUSD','frxUSDCAD','frxUSDCHF','frxNZDUSD','frxEURJPY','frxGBPJPY','frxEURGBP'];
const CRYPTO=[{label:'SOL/USD',keys:['solusd','crysolusd','solanausd']},{label:'BTC/USD',keys:['btcusd','crybtcusd','bitcoinusd']},{label:'ETH/USD',keys:['ethusd','cryethusd','ethereumusd']}];
const S={ws:null,req:0,pending:new Map(),symbols:[],symbol:'',raw:[],chartBars:[],price:null,chart:null,candleSeries:null,ema9:null,ema20:null,ema50:null,markerApi:null,visualLines:[],signal:null,signalTimer:null,trade:null,ops:[],backtestTimer:null,chartCountdown:null,lastPivotKey:'',lastAlertKey:'',lastClosed15:0,subId:null,heartbeat:null,ticks:[],tradeTimer:null};
const norm=x=>String(x||'').toLowerCase().replace(/[^a-z0-9]/g,'');
function status(t,ok=false){$('connection').textContent=t;$('connection').style.color=ok?'#20d18b':'#ffb95c'}
function send(p){return new Promise((resolve,reject)=>{if(!S.ws||S.ws.readyState!==1)return reject(Error('Deriv desconectada'));const id=++S.req,t=setTimeout(()=>{S.pending.delete(id);reject(Error('Tiempo de espera de Deriv'))},15000);S.pending.set(id,{resolve:x=>{clearTimeout(t);resolve(x)},reject:e=>{clearTimeout(t);reject(e)}});S.ws.send(JSON.stringify({...p,req_id:id}))})}
function connect(){return new Promise((resolve,reject)=>{const ws=new WebSocket(API);S.ws=ws;const timer=setTimeout(()=>{try{ws.close()}catch{}reject(Error('Tiempo de conexión agotado'))},12000);ws.onopen=()=>{clearTimeout(timer);status('Deriv conectada',true);if(S.heartbeat)clearInterval(S.heartbeat);S.heartbeat=setInterval(()=>send({ping:1}).catch(()=>{}),30000);resolve()};ws.onerror=()=>{clearTimeout(timer);reject(Error('Error de conexión Deriv'))};ws.onclose=()=>{if(ws!==S.ws)return;status('Desconectada · reconectando…');for(const p of S.pending.values())p.reject(Error('Conexión cerrada'));S.pending.clear();setTimeout(()=>start().catch(e=>status(e.message)),5000)};ws.onmessage=e=>{let m;try{m=JSON.parse(e.data)}catch{return}if(m.req_id&&S.pending.has(m.req_id)){const p=S.pending.get(m.req_id);S.pending.delete(m.req_id);m.error?p.reject(Error(m.error.message)):p.resolve(m);return}if(m.tick)onTick(m.tick)}})}
function findCrypto(active,a){return active.find(x=>{const v=[x.symbol,x.underlying_symbol,x.display_name,x.underlying_symbol_name].map(norm);return a.keys.some(k=>v.some(z=>z===norm(k)||z.includes(norm(k))))})}
async function loadSymbols(){const r=await send({active_symbols:'brief'}),active=(r.active_symbols||[]).filter(x=>!Number(x.is_trading_suspended));const list=[];for(const code of FOREX){const x=active.find(a=>(a.underlying_symbol||a.symbol)===code);if(x)list.push({code:x.underlying_symbol||x.symbol,name:x.display_name||x.underlying_symbol_name||code})}for(const a of CRYPTO){const x=findCrypto(active,a);if(x)list.push({code:x.underlying_symbol||x.symbol,name:a.label})}S.symbols=list;$('symbol').innerHTML=list.map(x=>'<option value="'+x.code+'">'+x.name+'</option>').join('');if(!list.length)throw Error('Deriv no devolvió pares Forex o criptomonedas disponibles');const preferred=list.find(x=>x.name==='SOL/USD')||list[0];$('symbol').value=preferred.code}
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
function aggregate1m(c){const map=new Map();for(const b of c){const t=Math.floor(b.time/60)*60;let x=map.get(t);if(!x){x={time:t,open:b.open,high:b.high,low:b.low,close:b.close,count:0};map.set(t,x)}x.high=Math.max(x.high,b.high);x.low=Math.min(x.low,b.low);x.close=b.close;x.count++}return [...map.values()]}
function updateVisuals(){
 if(!S.candleSeries||!S.chartBars.length)return;
 const bars=S.chartBars,markers=[],now=Date.now()/1000,cutoff=now-86400;
 const m10=aggregateMinutes(bars,10),pts=zigzag(m10);
 // Solo pivotes recientes y confirmados: evita llenar el gráfico de flechas.
 const pivots=pts.filter(p=>p.confirmed<m10.length&&p.time>=cutoff).slice(-6);
 for(const p of pivots)markers.push({time:p.time,position:p.type==='LOW'?'belowBar':'aboveBar',color:p.type==='LOW'?'#20d18b':'#ff5968',shape:p.type==='LOW'?'arrowUp':'arrowDown',text:''});
 for(const op of S.ops){if(op.symbol!==S.symbol||Date.now()-op.entryTime>86400000)continue;const t=Math.floor((op.entryTime/1000)/60)*60;markers.push({time:t,position:op.side==='BUY'?'belowBar':'aboveBar',color:op.side==='BUY'?'#20d18b':'#ff5968',shape:'circle',text:op.side==='BUY'?'COMPRA':'VENTA'});if(op.exitTime){const xt=Math.floor((op.exitTime/1000)/60)*60;markers.push({time:xt,position:op.side==='BUY'?'aboveBar':'belowBar',color:op.result==='WIN'?'#20d18b':op.result==='LOSS'?'#ff5968':'#f5c451',shape:'square',text:op.result==='WIN'?'W':op.result==='LOSS'?'L':'='});}}
 if(S.signal){const t=Math.floor(S.signal.pivot.time/60)*60;markers.push({time:t,position:S.signal.side==='BUY'?'belowBar':'aboveBar',color:'#f5c451',shape:'arrow',text:S.signal.side==='BUY'?'ENTRADA COMPRA':'ENTRADA VENTA'});}
 if(S.trade){const t=Math.floor((S.trade.entryTime/1000)/60)*60;markers.push({time:t,position:S.trade.side==='BUY'?'belowBar':'aboveBar',color:'#f5c451',shape:'circle',text:S.trade.side==='BUY'?'COMPRA ACTIVA':'VENTA ACTIVA'});}
 markers.sort((a,b)=>a.time-b.time);if(S.markerApi)S.markerApi.setMarkers(markers);
 S.visualLines.forEach(x=>{try{S.candleSeries.removePriceLine(x)}catch{}});S.visualLines=[];
 // No mostrar etiquetas en la escala de precios: se superponían unas con otras.
 const add=(price,title,color,style=2)=>{if(Number.isFinite(price))S.visualLines.push(S.candleSeries.createPriceLine({price,title,color,lineWidth:1,lineStyle:style,axisLabelVisible:false,title: title}))};
 const lows=pivots.filter(p=>p.type==='LOW'),highs=pivots.filter(p=>p.type==='HIGH');
 if(lows.length)add(lows.at(-1).price,'Soporte M10', '#20d18b',2);
 if(highs.length)add(highs.at(-1).price,'Resistencia M10','#ff5968',2);
 // Detectar únicamente el OB más reciente de las últimas tres velas M5.
 const m5=aggregateMinutes(bars,5),recent=m5.slice(-3);let ob=null;
 for(let i=recent.length-2;i>=0;i--){const a=recent[i],b=recent[i+1];if(a.close<a.open&&b.close>b.open&&b.close>a.high){ob={price:(a.high+a.low)/2,title:'OB alcista M5',color:'#20d18b'};break}if(a.close>a.open&&b.close<b.open&&b.close<a.low){ob={price:(a.high+a.low)/2,title:'OB bajista M5',color:'#ff5968'};break}}
 if(ob)add(ob.price,ob.title,ob.color,1);
}

function ema(c,p){const out=Array(c.length).fill(null),k=2/(p+1);let v=null;c.forEach((x,i)=>{v=v===null?x.close:x.close*k+v*(1-k);out[i]=v});return out}
function aggregate15(c){const map=new Map();for(const b of c){const t=Math.floor(b.time/15)*15;let x=map.get(t);if(!x){x={time:t,open:b.open,high:b.high,low:b.low,close:b.close,count:0};map.set(t,x)}x.high=Math.max(x.high,b.high);x.low=Math.min(x.low,b.low);x.close=b.close;x.count++}return [...map.values()].filter(x=>x.count===3)}
function zigzag(c,depth=DEPTH,sep=SEPARATION){const pts=[];for(let i=depth;i<c.length-depth;i++){let hi=true,lo=true;for(let j=1;j<=depth;j++){if(c[i].high<c[i-j].high||c[i].high<c[i+j].high)hi=false;if(c[i].low>c[i-j].low||c[i].low>c[i+j].low)lo=false}if(!hi&&!lo)continue;const p={index:i,time:c[i].time,price:hi?c[i].high:c[i].low,type:hi?'HIGH':'LOW',confirmed:i+depth};const last=pts.at(-1);if(!last||last.type!==p.type){if(!last||i-last.index>=sep)pts.push(p)}else if((p.type==='HIGH'&&p.price>last.price)||(p.type==='LOW'&&p.price<last.price))pts[pts.length-1]=p}return pts}
function stackDirection(c){if(c.length<55)return'NEUTRAL';const a=ema(c,9),b=ema(c,20),d=ema(c,50),i=c.length-1;if(a[i]>b[i]&&b[i]>d[i]&&a[i]>a[i-2]&&b[i]>b[i-2])return'BUY';if(a[i]<b[i]&&b[i]<d[i]&&a[i]<a[i-2]&&b[i]<b[i-2])return'SELL';return'NEUTRAL'}
function trend30Direction(){
 const m30=aggregateMinutes(S.chartBars,30);
 if(m30.length<20)return'NEUTRAL';
 const a=ema(m30,9),b=ema(m30,20),i=m30.length-1;
 if(a[i]>b[i]&&a[i]>a[i-1]&&b[i]>b[i-1])return'BUY';
 if(a[i]<b[i]&&a[i]<a[i-1]&&b[i]<b[i-1])return'SELL';
 return'NEUTRAL';
}
function strategyState(){const c=S.raw.slice(0,-1);if(c.length<60)return null;const pts=zigzag(c),p=pts.at(-1);if(!p||p.confirmed>=c.length)return null;const trend30=trend30Direction();if(trend30==='NEUTRAL')return null;const dir=stackDirection(c);if(dir==='NEUTRAL'||dir!==trend30)return null;const m15=aggregate15(c),confirm=m15.at(-1);if(!confirm)return null;const nowBar=c.at(-1);if(confirm.time+15>nowBar.time+5||confirm.time+15<p.time+(DEPTH+1)*5)return null;const prior=pts.slice(0,-1).filter(x=>x.type===p.type&&x.index<p.index&&p.index-x.index<=180).at(-1);const bullish=confirm.close>confirm.open,bearish=confirm.close<confirm.open;if(dir==='BUY'&&p.type==='LOW'&&bullish&&confirm.close>p.price)return{side:'BUY',pivot:p,confirm,dir,trend30,liquidity:prior?.price??p.price,targetPrice:p.price+(confirm.close-p.price)*0.5};if(dir==='SELL'&&p.type==='HIGH'&&bearish&&confirm.close<p.price)return{side:'SELL',pivot:p,confirm,dir,trend30,liquidity:prior?.price??p.price,targetPrice:p.price-(p.price-confirm.close)*0.5};return null}
function setSignal(s){if(S.signal||S.trade)return;const key=S.symbol+'|'+s.side+'|'+s.pivot.time+'|'+s.confirm.time;if(key===S.lastPivotKey)return;S.lastPivotKey=key;S.signal={...s,key,created:Date.now(),expires:Date.now()+90000,state:'WAIT_PRICE',targetPrice:s.targetPrice};$('signal').className='binary-signal '+(s.side==='BUY'?'buy':'sell');$('signalTitle').textContent=s.side==='BUY'?'🟢 ENTRADA DE COMPRA · A FAVOR DE TENDENCIA':'🔴 ENTRADA DE VENTA · A FAVOR DE TENDENCIA';$('signalInfo').textContent='Tendencia M30: '+(s.trend30==='BUY'?'ALCISTA':'BAJISTA')+' · Confirmación M1/M15s · Esperando precio de entrada.';$('signalPrice').textContent=fmt(s.targetPrice);$('signalCountdown').textContent='ESPERANDO';$('tradeState').textContent='SEÑAL PENDIENTE · LIQUIDEZ '+fmt(s.liquidity);updateVisuals();}
function monitorSignal(price,epoch){const s=S.signal;if(!s||S.trade)return;const now=Date.now(),prev=S.ticks.at(-1);S.ticks.push({price,time:epoch});if(S.ticks.length>8)S.ticks.shift();if(now>s.expires){$('signalTitle').textContent='SEÑAL VENCIDA';$('signalInfo').textContent='No alcanzó el precio objetivo dentro del tiempo permitido.';$('tradeState').textContent='VENCIDA';$('signalCountdown').textContent='—';S.signal=null;return;}if((s.side==='BUY'&&price<s.pivot.price)||(s.side==='SELL'&&price>s.pivot.price)){$('signalTitle').textContent='SEÑAL INVALIDADA';$('tradeState').textContent='INVALIDADA';$('signalInfo').textContent='El precio rompió el pivote que protegía la señal.';S.signal=null;return;}const crossed=prev&&(s.side==='BUY'?prev.price>s.targetPrice&&price<=s.targetPrice:prev.price<s.targetPrice&&price>=s.targetPrice);if(crossed||Math.abs(price-s.targetPrice)<=Math.max(Math.abs(s.targetPrice)*0.00001,0.000001)){startAutomaticTrade(price);return;}if(S.ticks.length>=3){const a=S.ticks[0],b=S.ticks.at(-1),secs=Math.max(1,b.time-a.time),velocity=(b.price-a.price)/secs,toward=s.side==='BUY'?velocity<0:velocity>0,eta=toward?Math.abs(s.targetPrice-price)/Math.abs(velocity):Infinity;if(eta<=10){$('signalTitle').textContent='⚠️ '+(s.side==='BUY'?'COMPRA':'VENTA')+' · LLEGA EN '+Math.max(0,Math.ceil(eta))+'s';$('tradeState').textContent='VIGENTE · PREALERTA 10s';$('signalCountdown').textContent=Math.max(0,eta).toFixed(1)+' s';}else{$('signalTitle').textContent=(s.side==='BUY'?'COMPRA':'VENTA')+' · ESPERANDO OBJETIVO';$('tradeState').textContent='VIGENTE · OBJETIVO PENDIENTE';$('signalCountdown').textContent='—';}}}
function evaluate(){if(S.trade||S.signal)return;const s=strategyState();if(s)setSignal(s)}
function onTick(t){
 if(t.symbol&&t.symbol!==S.symbol)return;
 const price=Number(t.quote),epoch=Number(t.epoch);if(!Number.isFinite(price)||!Number.isFinite(epoch))return;
 S.price=price;$('price').textContent=fmt(price);monitorSignal(price,epoch);
 const bucket=Math.floor(epoch/5)*5,last=S.raw.at(-1);if(!last)return;let closed=false;
 if(last.time===bucket){last.high=Math.max(last.high,price);last.low=Math.min(last.low,price);last.close=price}
 else if(bucket>last.time){S.raw.push({time:bucket,open:last.close,high:Math.max(last.close,price),low:Math.min(last.close,price),close:price});if(S.raw.length>20000)S.raw.shift();closed=true}else return;
 try{
  const minute=Math.floor(epoch/60)*60,lastBar=S.chartBars.at(-1);
  if(lastBar&&lastBar.time===minute){lastBar.high=Math.max(lastBar.high,price);lastBar.low=Math.min(lastBar.low,price);lastBar.close=price}
  else if(!lastBar||minute>lastBar.time){S.chartBars.push({time:minute,open:lastBar?lastBar.close:price,high:Math.max(lastBar?lastBar.close:price,price),low:Math.min(lastBar?lastBar.close:price,price),close:price});if(S.chartBars.length>1440)S.chartBars.shift()}
  const bars=S.chartBars;if(bars.length){const b=bars.at(-1),a=ema(bars,9),e=ema(bars,20),d=ema(bars,50),i=bars.length-1;S.candleSeries.update(b);S.ema9.update({time:b.time,value:a[i]});S.ema20.update({time:b.time,value:e[i]});S.ema50.update({time:b.time,value:d[i]});}
  const dir=stackDirection(S.raw);$('trend').textContent=dir==='BUY'?'ALCISTA':dir==='SELL'?'BAJISTA':'SIN ALINEACIÓN';
  $('chartTitle').textContent=S.symbol+' · M1 · 24H · '+bars.length+' velas';
  if(closed)evaluate();
  if(closed&&bucket%60===0){updateVisuals();runBacktest()}
  if(S.trade&&Date.now()>=S.trade.deadline)finishTrade(price);
 }catch(e){console.error(e)}
}
function fmt(v){if(!Number.isFinite(Number(v)))return'—';return Number(v).toPrecision(8).replace(/(\.\d*?)0+$/,'$1').replace(/\.$/,'')}
function runBacktest(){
 const c=S.raw.slice(0,-1);
 if(c.length<100){$('backtestResult').textContent='Histórico insuficiente: se necesitan al menos 100 velas de 5 segundos.';return}
 const e9=ema(c,9),e20=ema(c,20),e50=ema(c,50),points=[],trades=[];
 let group=null,confirm=null,lastKey='',busyUntil=-1,checked=0;
 for(let i=0;i<c.length&&trades.length<500;i++){
  const bar=c[i],bucket=Math.floor(bar.time/15)*15;
  if(!group||group.time!==bucket){group={time:bucket,open:bar.open,high:bar.high,low:bar.low,close:bar.close,count:1}}
  else{group.high=Math.max(group.high,bar.high);group.low=Math.min(group.low,bar.low);group.close=bar.close;group.count++}
  if(group.count===3)confirm={...group};
  const pi=i-DEPTH;
  if(pi>=DEPTH){
   let hi=true,lo=true;
   for(let j=1;j<=DEPTH;j++){if(c[pi].high<c[pi-j].high||c[pi].high<c[pi+j].high)hi=false;if(c[pi].low>c[pi-j].low||c[pi].low>c[pi+j].low)lo=false}
   if(hi||lo){
    const p={index:pi,time:c[pi].time,price:hi?c[pi].high:c[pi].low,type:hi?'HIGH':'LOW',confirmed:i},last=points.at(-1);
    if(!last||last.type!==p.type){if(!last||pi-last.index>=SEPARATION)points.push(p)}
    else if((p.type==='HIGH'&&p.price>last.price)||(p.type==='LOW'&&p.price<last.price))points[points.length-1]=p;
   }
  }
  if(i<60||i<=busyUntil||!confirm||confirm.count!==3)continue;
  const p=points.at(-1);if(!p||p.confirmed!==i)continue;
  const m30=aggregateMinutes(c,30),m30a=ema(m30,9),m30b=ema(m30,20),mi=m30.length-1;const trend30=m30.length>=20?(m30a[mi]>m30b[mi]&&m30a[mi]>m30a[mi-1]&&m30b[mi]>m30b[mi-1]?'BUY':m30a[mi]<m30b[mi]&&m30a[mi]<m30a[mi-1]&&m30b[mi]<m30b[mi-1]?'SELL':'NEUTRAL'):'NEUTRAL';const dir=e9[i]>e20[i]&&e20[i]>e50[i]&&e9[i]>e9[i-2]&&e20[i]>e20[i-2]?'BUY':e9[i]<e20[i]&&e20[i]<e50[i]&&e9[i]<e9[i-2]&&e20[i]<e20[i-2]?'SELL':'NEUTRAL';
  if(dir==='NEUTRAL')continue;
  const bullish=confirm.close>confirm.open,bearish=confirm.close<confirm.open;
  let side=null,target=NaN;
  if(dir==='BUY'&&p.type==='LOW'&&bullish&&confirm.close>p.price){side='BUY';target=p.price+(confirm.close-p.price)*.5}
  if(dir==='SELL'&&p.type==='HIGH'&&bearish&&confirm.close<p.price){side='SELL';target=p.price-(p.price-confirm.close)*.5}
  if(!side)continue;
  const key=side+'|'+p.time;if(key===lastKey)continue;lastKey=key;checked++;
  const deadline=bar.time+90,tol=Math.max(Math.abs(target)*.00001,.000001);let entry=-1;
  for(let k=i+1;k<c.length&&c[k].time<=deadline;k++){
   if(side==='BUY'?c[k].low<=target+tol:c[k].high>=target-tol){entry=k;break}
  }
  if(entry<0)continue;
  const exitTime=c[entry].time+120;let exit=-1;
  for(let k=entry+1;k<c.length;k++){if(c[k].time>=exitTime){exit=k;break}}
  if(exit<0)continue;
  const result=side==='BUY'?(c[exit].close>target?'WIN':c[exit].close<target?'LOSS':'EMPATE'):(c[exit].close<target?'WIN':c[exit].close>target?'LOSS':'EMPATE');
  trades.push({id:'BT-'+S.symbol+'-'+c[entry].time,symbol:S.symbol,side,entry:target,entryTime:c[entry].time*1000,exit:c[exit].close,exitTime:c[exit].time*1000,result,mode:'BACKTEST',pivotTime:p.time,targetPrice:target});
  busyUntil=exit; 
 }
 const previous=S.ops.filter(x=>!(x.mode==='BACKTEST'&&x.symbol===S.symbol));
 S.ops=[...trades,...previous].sort((a,b)=>b.entryTime-a.entryTime).slice(0,2000);
 saveOps();renderOps();updateVisuals();
 const wins=trades.filter(x=>x.result==='WIN').length,losses=trades.filter(x=>x.result==='LOSS').length,draws=trades.filter(x=>x.result==='EMPATE').length,total=trades.length,rate=total?100*wins/total:0;
 const hours=(c.length*5/3600).toFixed(1);
 $('backtestResult').textContent='BACKTEST · '+total+' de hasta 500 operaciones anteriores · '+c.length+' velas de 5s ('+hours+' h) · señales detectadas: '+checked+' · WIN '+wins+' · LOSS '+losses+' · EMPATE '+draws+' · efectividad '+rate.toFixed(1)+'%. '+(total<500?'No se encontraron 500 operaciones completas en las últimas 24 horas.':'Las 500 operaciones están cargadas en Historial y marcadas en el gráfico.');
}
function loadOps(){try{const a=JSON.parse(localStorage.getItem(STORE+'-operations')||'[]');S.ops=Array.isArray(a)?a:[]}catch{S.ops=[]}renderOps()}
function saveOps(){localStorage.setItem(STORE+'-operations',JSON.stringify(S.ops.slice(0,2000)))}
function startAutomaticTrade(entryPrice){if(!S.signal||S.trade||!Number.isFinite(entryPrice))return;const s=S.signal;S.signal=null;const now=Date.now();S.trade={id:String(now)+'-'+Math.random().toString(36).slice(2,7),symbol:S.symbol,side:s.side,entry:entryPrice,entryTime:now,deadline:now+EXPIRY,pivotTime:s.pivot.time,liquidity:s.liquidity,targetPrice:s.targetPrice,result:'OPEN',mode:'AUTO'};S.ops.unshift({...S.trade});saveOps();$('tradeState').textContent=s.side==='BUY'?'COMPRA AUTOMÁTICA ACTIVA':'VENTA AUTOMÁTICA ACTIVA';$('signalTitle').textContent=s.side==='BUY'?'COMPRA EN CURSO':'VENTA EN CURSO';$('signalInfo').textContent='Entrada automática al tocar '+fmt(S.trade.targetPrice)+' · precio '+fmt(S.trade.entry)+' · expiración en 2 minutos';$('signalCountdown').textContent='120 s';renderOps();updateVisuals();updateChartCountdown();if(S.tradeTimer)clearInterval(S.tradeTimer);let lastHistorySecond=-1;S.tradeTimer=setInterval(()=>{if(!S.trade)return;const left=Math.max(0,S.trade.deadline-Date.now()),sec=Math.ceil(left/1000);$('signalCountdown').textContent=(left/1000).toFixed(1)+' s';updateChartCountdown();if(sec!==lastHistorySecond){lastHistorySecond=sec;renderOps()}if(left<=0&&Number.isFinite(S.price))finishTrade(S.price)},100)}function finishTrade(exit){if(!S.trade)return;const t=S.trade;const result=t.side==='BUY'?(exit>t.entry?'WIN':exit<t.entry?'LOSS':'EMPATE'):(exit<t.entry?'WIN':exit>t.entry?'LOSS':'EMPATE');const op=S.ops.find(x=>x.id===t.id);if(op){op.exit=exit;op.exitTime=Date.now();op.result=result}S.trade=null;updateChartCountdown();if(S.tradeTimer)clearInterval(S.tradeTimer);$('tradeState').textContent=result;$('signalTitle').textContent=result;$('signalInfo').textContent='Entrada '+fmt(t.entry)+' · cierre '+fmt(exit);$('signalCountdown').textContent='—';saveOps();renderOps();updateVisuals()}
function renderOps(){
 const wins=S.ops.filter(x=>x.result==='WIN').length,loss=S.ops.filter(x=>x.result==='LOSS').length,draw=S.ops.filter(x=>x.result==='EMPATE').length,done=wins+loss+draw;
 $('wins').textContent=wins;$('losses').textContent=loss;$('draws').textContent=draw;$('rate').textContent=(done?100*wins/done:0).toFixed(1)+'%';$('total').textContent=S.ops.length;
 const countdown=x=>{if(x.result&&x.exitTime)return'02:00';const left=Math.max(0,Math.ceil(((x.entryTime||Date.now())+120000-Date.now())/1000));return String(Math.floor(left/60)).padStart(2,'0')+':'+String(left%60).padStart(2,'0')};
 $('history').innerHTML=S.ops.map(x=>'<div class="op-row '+(x.result==='WIN'?'win':x.result==='LOSS'?'loss':'')+'"><b class="op-star '+(x.side==='BUY'?'buy':'sell')+'">★</b><b>'+x.symbol+(x.mode==='BACKTEST'?' · BT':'')+'</b><b>'+(x.side==='BUY'?'COMPRA':'VENTA')+'</b><span class="op-countdown">'+countdown(x)+'</span><strong>'+(x.result||'ACTIVA')+'</strong></div>').join('')||'Todavía no hay operaciones registradas.';
}
function initChart(){const L=LightweightCharts;$('chart').innerHTML='';S.chart=L.createChart($('chart'),{autoSize:true,layout:{background:{type:'solid',color:'#0a1320'},textColor:'#aab9ca'},grid:{vertLines:{color:'#1b2a3d'},horzLines:{color:'#1b2a3d'}},timeScale:{timeVisible:true,secondsVisible:false,borderColor:'#34445a',rightOffset:4,barSpacing:3,minBarSpacing:0.5},rightPriceScale:{borderColor:'#34445a'},handleScroll:{mouseWheel:true,pressedMouseMove:true,horzTouchDrag:true},handleScale:{mouseWheel:true,pinch:true}});S.candleSeries=S.chart.addSeries(L.CandlestickSeries,{upColor:'#20d18b',downColor:'#ff5968',wickUpColor:'#20d18b',wickDownColor:'#ff5968',borderVisible:false});S.ema9=S.chart.addSeries(L.LineSeries,{color:'#318bff',lineWidth:2,title:'EMA 9'});S.ema20=S.chart.addSeries(L.LineSeries,{color:'#ff9d28',lineWidth:2,title:'EMA 20'});S.ema50=S.chart.addSeries(L.LineSeries,{color:'#b36bff',lineWidth:2,title:'EMA 50'});const bars=S.chartBars;S.candleSeries.setData(bars);const a=ema(bars,9),b=ema(bars,20),d=ema(bars,50);S.ema9.setData(bars.map((x,i)=>({time:x.time,value:a[i]})));S.ema20.setData(bars.map((x,i)=>({time:x.time,value:b[i]})));S.ema50.setData(bars.map((x,i)=>({time:x.time,value:d[i]})));if(L.createSeriesMarkers)S.markerApi=L.createSeriesMarkers(S.candleSeries,[]);updateVisuals();S.chart.timeScale().fitContent()}
async function subscribe(){if(S.subId){try{await send({forget:S.subId})}catch{}S.subId=null}const r=await send({ticks:S.symbol,subscribe:1});S.subId=r.subscription?.id||null;if(r.tick)onTick(r.tick)}
async function loadCurrent(){if(S.trade){$('symbol').value=S.symbol;return}S.symbol=$('symbol').value;if(!S.symbol)return;status('Cargando histórico completo de 24 horas…');$('chartTitle').textContent=S.symbol+' · cargando velas M1';S.raw=await history(S.symbol);S.chartBars=await chartHistory(S.symbol);$('chartTitle').textContent=S.symbol+' · M1 · 24H · '+S.chartBars.length+' velas';S.signal=null;S.ticks=[];S.lastPivotKey='';if(S.signalTimer)clearInterval(S.signalTimer);$('signalTitle').textContent='ESPERANDO CONFIGURACIÓN';$('signalInfo').textContent='Tendencia M30 + EMA 9/20/50 + confirmación 15 segundos';$('signalCountdown').textContent='—';$('tradeState').textContent='SIN OPERACIÓN';initChart();runBacktest();await subscribe();status('EN VIVO · '+S.symbol+' · '+S.raw.length+' velas 5s / '+S.chartBars.length+' velas M1',true)}
async function start(){try{await connect();await loadSymbols();const saved=localStorage.getItem(STORE+'-symbol');if(saved&&S.symbols.some(x=>x.code===saved))$('symbol').value=saved;loadOps();await loadCurrent()}catch(e){status(e.message);setTimeout(()=>start().catch(x=>status(x.message)),7000)}}
$('symbol').addEventListener('change',()=>{localStorage.setItem(STORE+'-symbol',$('symbol').value);loadCurrent().catch(e=>status(e.message))});$('reload').addEventListener('click',()=>loadCurrent().catch(e=>status(e.message)));start();
})();