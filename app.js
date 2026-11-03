const signals=[],operations=[],history=[],backtestTrades=[];
let signalCounter=0,lastSignalKey="",selectedMarket=null,backtestSymbol=null,m1Candles=[],backtestReady=false;
const TZ="America/Panama";
function panamaParts(ts=Date.now()){const p=new Intl.DateTimeFormat("en-CA",{timeZone:TZ,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date(ts));return Object.fromEntries(p.map(x=>[x.type,x.value]));}
function panamaDay(ts){const p=panamaParts(ts);return p.year+"-"+p.month+"-"+p.day;}
function updateDailyPanel(){const now=new Date(),date=panamaDay(now.getTime());const clock=new Intl.DateTimeFormat("es-PA",{timeZone:TZ,hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false}).format(now);const label=new Intl.DateTimeFormat("es-PA",{timeZone:TZ,day:"2-digit",month:"2-digit",year:"numeric"}).format(now);const c=document.getElementById("panama-clock");if(c)c.textContent=clock+" · "+label;const today=backtestTrades.filter(t=>panamaDay(t.exitTime||t.entryTime)===date);const wins=today.filter(t=>t.result==="GANADA").length,losses=today.filter(t=>t.result==="PERDIDA").length,total=wins+losses;setText("daily-wins",wins);setText("daily-losses",losses);setText("daily-total",total);setText("daily-rate",total?(wins/total*100).toFixed(1)+"%":"0%");setText("daily-date",date);}
function setText(id,value){const e=document.getElementById(id);if(e)e.textContent=value;}
function selectMarket(name,symbol){selectedMarket={name,symbol};document.querySelectorAll(".market").forEach(c=>c.classList.toggle("active",c.dataset.symbol===symbol));setText("chart-title",name);setText("chart-message","Cargando historial real...");if(typeof openMarket==="function")openMarket(symbol);}
function addSignal(data){if(!data||signals.some(s=>s.symbol===data.symbol&&s.status==="ACTIVE"))return;signalCounter++;signals.unshift({id:"SIG-"+String(signalCounter).padStart(4,"0"),createdAt:Date.now(),status:"ACTIVE",...data});renderSignals();}
function markEntered(id){const s=signals.find(x=>x.id===id);if(!s||s.status!=="ACTIVE")return;s.status="ENTERED";operations.unshift({...s,enteredAt:Date.now(),currentPrice:Number(s.entry),result:"OPEN"});renderSignals();renderOperations();}
function markIgnored(id){const s=signals.find(x=>x.id===id);if(!s||s.status!=="ACTIVE")return;s.status="IGNORED";history.unshift({...s,result:"NO ENTRÉ",finishedAt:Date.now()});renderSignals();renderHistory();}
function updateOperationPrice(symbol,price){operations.forEach(op=>{if(op.symbol!==symbol||op.result!=="OPEN")return;op.currentPrice=Number(price);if(op.protectionActive){const distance=Math.max(op.entry*0.0005,Math.abs(op.entry-op.sl)*0.25);const candidate=op.direction==="COMPRAR"?price-distance:price+distance;op.protectionSL=op.direction==="COMPRAR"?Math.max(op.protectionSL||-Infinity,candidate):Math.min(op.protectionSL||Infinity,candidate);}});renderOperations();renderHistory();}
function isDoji(c){const range=c.high-c.low;if(range<=0)return false;return Math.abs(c.close-c.open)/range<=0.12;}
function evaluateOpenOperations(symbol,candle){operations.forEach(op=>{if(op.symbol!==symbol||op.result!=="OPEN"||op.lastManagedCandle===candle.time)return;op.lastManagedCandle=candle.time;const doji=isDoji(candle),opposite=op.direction==="COMPRAR"?candle.close<candle.open:candle.close>candle.open;if(doji){op.protectionActive=true;const distance=Math.max(op.entry*0.0005,Math.abs(op.entry-op.sl)*0.25);const candidate=op.direction==="COMPRAR"?candle.close-distance:candle.close+distance;op.protectionSL=op.direction==="COMPRAR"?Math.max(op.protectionSL||-Infinity,candidate):Math.min(op.protectionSL||Infinity,candidate);op.managementMessage="PROTEGER OPERACIÓN · SL sugerido";}else if(opposite){op.result="GANADA";op.exitPrice=candle.close;op.exitReason="TP1 · VELA CONTRARIA";op.finishedAt=candle.time*1000;history.unshift({...op});}else{op.managementMessage=op.protectionActive?"PROTECCIÓN ACTIVA · SL dinámico":"EN SEGUIMIENTO";}});renderOperations();renderHistory();}
function renderSignals(){const area=document.getElementById("signals");if(!area)return;const active=signals.filter(s=>s.status==="ACTIVE");setText("signal-count",active.length);area.innerHTML=active.length?active.map(s=>`<article class="signal-card"><div class="muted">${s.id} · ${s.market}</div><h3 class="${s.direction==="COMPRAR"?"buy":"sell"}">${s.direction}</h3><div class="levels"><div class="level"><span>ENTRADA</span><strong>${fmt(s.entry)}</strong></div><div class="level"><span>SL</span><strong>${fmt(s.sl)}</strong></div><div class="level"><span>TP1 ESTRUCTURAL</span><strong>${fmt(s.tp1)}</strong></div><div class="level"><span>TP2</span><strong>${fmt(s.tp2)}</strong></div></div><div class="muted">RSI ${s.rsi.toFixed(1)} · EMA 9/20/50</div><div class="action-row"><button class="enter-button" onclick="markEntered('${s.id}')">ENTRÉ</button><button class="ignore-button" onclick="markIgnored('${s.id}')">NO ENTRÉ</button></div></article>`).join(""):'<div class="empty-state">No hay señales activas.</div>';}
function renderOperations(){const area=document.getElementById("operations");if(!area)return;const open=operations.filter(x=>x.result==="OPEN");setText("operation-count",open.length);area.innerHTML=open.length?open.map(o=>`<article class="operation-card"><strong>${o.market} · ${o.direction}</strong><p>Entrada ${fmt(o.entry)} · Actual ${fmt(o.currentPrice)}</p><p>SL inicial ${fmt(o.sl)} · TP1 ${fmt(o.tp1)} · TP2 ${fmt(o.tp2)}</p>${o.protectionActive?`<p class="result-warning">PROTEGER OPERACIÓN · Coloca SL manual en ${fmt(o.protectionSL)}</p>`:`<p class="result-warning">${o.managementMessage||"EN SEGUIMIENTO"}</p>`}</article>`).join(""):'<div class="empty-state">No tienes operaciones manuales abiertas.</div>';}
function renderHistory(){const a=document.getElementById("history");if(!a)return;a.innerHTML=history.length?history.slice(0,100).map(x=>`<article class="history-card"><strong>${x.market||""}</strong><p>${x.direction||""} · ${x.result}</p></article>`).join(""):'<div class="empty-state">Sin resultados registrados.</div>';}
function fmt(v){return Number(v).toPrecision(7).replace(/0+$/,"").replace(/\.$/,"");}
function emaAt(v,p,end=v.length-1){if(end+1<p)return null;let x=v.slice(0,p).reduce((a,b)=>a+b,0)/p,k=2/(p+1);for(let i=p;i<=end;i++)x=v[i]*k+x*(1-k);return x;}
function rsiSeries(values,period=14){const out=Array(values.length).fill(null);if(values.length<=period)return out;let gain=0,loss=0;for(let i=1;i<=period;i++){const d=values[i]-values[i-1];gain+=Math.max(0,d);loss+=Math.max(0,-d);}let ag=gain/period,al=loss/period;out[period]=al===0?100:100-100/(1+ag/al);for(let i=period+1;i<values.length;i++){const d=values[i]-values[i-1];ag=(ag*(period-1)+Math.max(0,d))/period;al=(al*(period-1)+Math.max(0,-d))/period;out[i]=al===0?100:100-100/(1+ag/al);}return out;}
const rsiConfig={timeframe:300,period:14,low:40,mid:50,high:60};
function aggregateRsiCandles(candles,seconds){
 if(seconds<=60)return candles.map((c,i)=>({...c,_sourceIndex:i}));
 const buckets=new Map();
 candles.forEach((c,i)=>{const key=Math.floor(c.time/seconds)*seconds;let b=buckets.get(key);if(!b){b={time:key,open:c.open,high:c.high,low:c.low,close:c.close,_sourceIndex:i};buckets.set(key,b);}else{b.high=Math.max(b.high,c.high);b.low=Math.min(b.low,c.low);b.close=c.close;b._sourceIndex=i;}});
 return [...buckets.values()].sort((a,b)=>a.time-b.time);
}
function configuredRsiSeries(candles){
 const period=Math.max(2,Math.min(200,Number(rsiConfig.period)||14)),seconds=Math.max(60,Number(rsiConfig.timeframe)||300);
 const grouped=aggregateRsiCandles(candles,seconds),values=rsiSeries(grouped.map(c=>c.close),period),out=Array(candles.length).fill(null);
 let j=0,last=null;
 for(let i=0;i<candles.length;i++){
  const bucket=Math.floor(candles[i].time/seconds)*seconds;
  while(j<grouped.length&&grouped[j].time<bucket){if(values[j]!=null)last=values[j];j++;}
  out[i]=last;
 }
 return out;
}
function applyRsiSettings(){
 const tf=document.getElementById("rsi-timeframe"),per=document.getElementById("rsi-period"),lo=document.getElementById("rsi-low"),mi=document.getElementById("rsi-mid"),hi=document.getElementById("rsi-high");
 if(tf)rsiConfig.timeframe=Number(tf.value)||300;
 if(per)rsiConfig.period=Math.max(2,Math.min(200,Number(per.value)||14));
 if(lo)rsiConfig.low=Math.max(1,Math.min(98,Number(lo.value)||40));
 if(mi)rsiConfig.mid=Math.max(rsiConfig.low+1,Math.min(99,Number(mi.value)||50));
 if(hi)rsiConfig.high=Math.max(rsiConfig.mid+1,Math.min(100,Number(hi.value)||60));
 lastSignalKey="";
 if(m1Candles.length)runBacktest(backtestSymbol||selectedMarket?.symbol,selectedMarket?.name||"",m1Candles);
 if(selectedMarket&&typeof openMarket==="function")analyzeCandles(selectedMarket.symbol,selectedMarket.name,m1Candles);
}
document.addEventListener("DOMContentLoaded",()=>{["rsi-timeframe","rsi-period","rsi-low","rsi-mid","rsi-high"].forEach(id=>{const e=document.getElementById(id);if(e)e.addEventListener("change",applyRsiSettings);});});

function swingPoints(candles,at){const highs=[],lows=[];for(let i=2;i<at-2;i++){const c=candles[i];if(c.high>candles[i-1].high&&c.high>candles[i-2].high&&c.high>=candles[i+1].high&&c.high>=candles[i+2].high)highs.push({i,v:c.high});if(c.low<candles[i-1].low&&c.low<candles[i-2].low&&c.low<=candles[i+1].low&&c.low<=candles[i+2].low)lows.push({i,v:c.low});}return{highs,lows};}
function buildSignal(candles,i,rsis){
 if(i<60||rsis[i]==null||rsis[i-1]==null)return null;
 const closes=candles.slice(0,i+1).map(c=>c.close),c=candles[i],r=rsis[i],prev=rsis[i-1];
 const e9=emaAt(closes,9),e20=emaAt(closes,20),e50=emaAt(closes,50);
 const p9=emaAt(closes,9,i-1),p20=emaAt(closes,20,i-1),p50=emaAt(closes,50,i-1);
 if([e9,e20,e50,p9,p20,p50].some(x=>x==null))return null;
 const bullishTrend=e9>e20&&e20>e50&&e9>p9&&e20>p20&&e50>=p50;
 const bearishTrend=e9<e20&&e20<e50&&e9<p9&&e20<p20&&e50<=p50;
 const buySetup=prev<rsiConfig.high&&r>=rsiConfig.high&&bullishTrend;
 const sellSetup=prev>rsiConfig.low&&r<=rsiConfig.low&&bearishTrend;
 if(!buySetup&&!sellSetup)return null;
 const dir=buySetup?"COMPRAR":"VENDER",sw=swingPoints(candles,i),entry=c.close;let sl,tp1,tp2;
 if(buySetup){
  const supports=sw.lows.filter(x=>x.i<i&&x.v<entry);sl=supports.length?supports.at(-1).v:Math.min(...candles.slice(Math.max(0,i-7),i+1).map(x=>x.low));
  const risk=entry-sl;
  const targets=sw.highs.filter(x=>x.i<i&&x.v>=entry+risk*1.5).map(x=>x.v).sort((x,y)=>x-y);
  tp1=targets[0];tp2=targets.find(v=>v>=entry+risk*2.5&&v>tp1);
 }else{
  const resist=sw.highs.filter(x=>x.i<i&&x.v>entry);sl=resist.length?resist.at(-1).v:Math.max(...candles.slice(Math.max(0,i-7),i+1).map(x=>x.high));
  const risk=sl-entry;
  const targets=sw.lows.filter(x=>x.i<i&&x.v<=entry-risk*1.5).map(x=>x.v).sort((x,y)=>y-x);
  tp1=targets[0];tp2=targets.find(v=>v<=entry-risk*2.5&&v<tp1);
 }
 if(!Number.isFinite(tp1)||!Number.isFinite(tp2)||!Number.isFinite(sl)||(dir==="COMPRAR"?(sl>=entry||tp1<=entry||tp2<=tp1):(sl<=entry||tp1>=entry||tp2>=tp1)))return null;
 return{direction:dir,entry,sl,tp1,tp2,rsi:r,time:c.time,index:i};
}
function rejectionExit(dir,c){return !isDoji(c)&&(dir==="COMPRAR"?c.close<c.open:c.close>c.open);}
function structuralLevels(candles,i,direction,entry){
 const sw=swingPoints(candles,i);let sl,tp1,tp2;
 if(direction==="COMPRAR"){
  const supports=sw.lows.filter(x=>x.i<i&&x.v<entry);sl=supports.length?supports.at(-1).v:Math.min(...candles.slice(Math.max(0,i-7),i+1).map(x=>x.low));
  const targets=sw.highs.filter(x=>x.i<i&&x.v>entry).map(x=>x.v).sort((a,b)=>a-b);tp1=targets[0];tp2=targets.find(v=>v>tp1);
 }else{
  const resist=sw.highs.filter(x=>x.i<i&&x.v>entry);sl=resist.length?resist.at(-1).v:Math.max(...candles.slice(Math.max(0,i-7),i+1).map(x=>x.high));
  const targets=sw.lows.filter(x=>x.i<i&&x.v<entry).map(x=>x.v).sort((a,b)=>b-a);tp1=targets[0];tp2=targets.find(v=>v<tp1);
 }
 if(!Number.isFinite(sl)||!Number.isFinite(tp1)||!Number.isFinite(tp2))return null;
 if(direction==="COMPRAR"?(sl>=entry||tp1<=entry||tp2<=tp1):(sl<=entry||tp1>=entry||tp2>=tp1))return null;
 return{sl,tp1,tp2};
}
function runBacktest(symbol,market,candles){
 if(!Array.isArray(candles)||candles.length<65)return;
 const data=candles.slice().sort((a,b)=>a.time-b.time),rs=configuredRsiSeries(data);backtestTrades.length=0;let active=null;
 for(let i=60;i<data.length-1;i++){
  const c=data[i];
  if(active){
   let exit=null;const stop=active.protectionSL??active.sl;
   if(active.direction==="COMPRAR"?c.low<=stop:c.high>=stop)exit={result:active.tp1Hit?"GANADA":"PERDIDA",price:stop,reason:active.tp1Hit?"SL PROTEGIDO":"SL"};
   else if(!active.tp1Hit&&(active.direction==="COMPRAR"?c.high>=active.tp1:c.low<=active.tp1)){active.tp1Hit=true;active.protectionSL=active.entry;active.tp1Time=c.time*1000;}
   else if(active.tp1Hit&&(active.direction==="COMPRAR"?c.high>=active.tp2:c.low<=active.tp2))exit={result:"GANADA",price:active.tp2,reason:"TP2"};
   if(exit){backtestTrades.push({...active,...exit,exitTime:c.time*1000});active=null;}
  }
  if(!active){
   const signal=buildSignal(data,i,rs);
   if(signal){
    active={...signal,symbol,market,entryTime:c.time*1000,tp1Hit:false};
   }
  }
 }
 if(active)backtestTrades.push({...active,result:"ABIERTA",exitTime:null});
 backtestSymbol=symbol;backtestReady=true;updateDailyPanel();
 if(typeof setBacktestTrades==="function")setBacktestTrades(backtestTrades);
 drawRsiPanel(rs,data);
 const closed=backtestTrades.filter(t=>t.result!=="ABIERTA"),wins=closed.filter(t=>t.result==="GANADA").length,losses=closed.filter(t=>t.result==="PERDIDA").length,tp1Hits=closed.filter(t=>t.tp1Hit).length,tp2Hits=closed.filter(t=>t.reason==="TP2").length,rate=closed.length?(wins/closed.length*100).toFixed(1):"0.0";
 setText("chart-message","Backtest M1 · RSI "+(rsiConfig.timeframe/60)+"m ("+rsiConfig.period+") · "+closed.length+" cerradas · "+rate+"% ganadas · TP1 "+tp1Hits+" · TP2 "+tp2Hits+" · "+losses+" pérdidas · Objetivos mínimos 1.5R / 2.5R");
}
function drawRsiPanel(series,candles){const host=document.getElementById("rsi-area");if(!host)return;host.innerHTML="";const cv=document.createElement("canvas");cv.style.cssText="width:100%;height:100%;display:block";host.appendChild(cv);const dpr=Math.min(devicePixelRatio||1,2),w=host.clientWidth,h=host.clientHeight;cv.width=w*dpr;cv.height=h*dpr;const x=cv.getContext("2d");x.scale(dpr,dpr);const left=24,right=8,top=10,bottom=18,ph=h-top-bottom,pw=w-left-right;for(const level of [rsiConfig.low,rsiConfig.mid,rsiConfig.high]){const y=top+(100-level)/100*ph;x.strokeStyle=level===50?"#8495aa":"#43546b";x.setLineDash([4,3]);x.beginPath();x.moveTo(left,y);x.lineTo(w-right,y);x.stroke();x.setLineDash([]);x.fillStyle="#a8b5c6";x.font="9px Arial";x.fillText(String(level),2,y+3);}const start=Math.max(0,series.length-200);x.beginPath();let begun=false;for(let i=start;i<series.length;i++){if(series[i]==null)continue;const px=left+(i-start)/Math.max(1,series.length-start-1)*pw,py=top+(100-series[i])/100*ph;if(!begun){x.moveTo(px,py);begun=true;}else x.lineTo(px,py);}x.strokeStyle="#48a8ff";x.lineWidth=1.7;x.stroke();setText("rsi-current","RSI: "+(series.at(-1)==null?"--":series.at(-1).toFixed(1)));}
function analyzeCandles(symbol,market,candles){if(!candles||candles.length<61)return;const closedIndex=candles.length-2;evaluateOpenOperations(symbol,candles[closedIndex]);const rs=configuredRsiSeries(candles),s=buildSignal(candles,closedIndex,rs);drawRsiPanel(rs,candles);if(!s)return;const key=symbol+":"+s.time+":"+s.direction;if(key===lastSignalKey)return;lastSignalKey=key;addSignal({...s,symbol,market,quality:80,candleTime:s.time});if(typeof drawTradeLevels==="function")drawTradeLevels(s);}
function setAnalysisGranularity(seconds){analysisGranularity=60;lastSignalKey="";backtestTrades.length=0;backtestReady=false;}
function setBacktestHistory(symbol,market,candles){if(!candles||!candles.length)return;m1Candles=candles.slice();runBacktest(symbol,market,m1Candles);}
function updateBacktestTick(epoch,price){if(!Number.isFinite(epoch)||!Number.isFinite(price)||!m1Candles.length)return;const interval=60,bucket=Math.floor(epoch/interval)*interval,last=m1Candles.at(-1);if(last&&last.time===bucket){m1Candles[m1Candles.length-1]={...last,high:Math.max(last.high,price),low:Math.min(last.low,price),close:price};return;}if(!last||bucket>last.time){m1Candles.push({time:bucket,open:price,high:price,low:price,close:price});runBacktest(backtestSymbol||selectedMarket?.symbol,selectedMarket?.name||"",m1Candles);}}
document.addEventListener("DOMContentLoaded",()=>{if(typeof createMarketChart==="function")createMarketChart();updateDailyPanel();setInterval(updateDailyPanel,1000);});
