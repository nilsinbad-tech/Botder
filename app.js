const signals=[],operations=[],history=[],backtestTrades=[];
let signalCounter=0,lastSignalKey="",selectedMarket=null,backtestSymbol=null,m1Candles=[],backtestReady=false;
const TZ="America/Panama";
function panamaParts(ts=Date.now()){const p=new Intl.DateTimeFormat("en-CA",{timeZone:TZ,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date(ts));return Object.fromEntries(p.map(x=>[x.type,x.value]));}
function panamaDay(ts){const p=panamaParts(ts);return p.year+"-"+p.month+"-"+p.day;}
function updateDailyPanel(){const now=new Date(),date=panamaDay(now.getTime());const clock=new Intl.DateTimeFormat("es-PA",{timeZone:TZ,hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false}).format(now);const label=new Intl.DateTimeFormat("es-PA",{timeZone:TZ,day:"2-digit",month:"2-digit",year:"numeric"}).format(now);const c=document.getElementById("panama-clock");if(c)c.textContent=clock+" · "+label;const today=backtestTrades.filter(t=>panamaDay(t.exitTime||t.entryTime)===date);const wins=today.filter(t=>t.result==="GANADA").length,losses=today.filter(t=>t.result==="PERDIDA").length,total=wins+losses;setText("daily-wins",wins);setText("daily-losses",losses);setText("daily-total",total);setText("daily-rate",total?(wins/total*100).toFixed(1)+"%":"0%");setText("daily-date",date);}
function setText(id,value){const e=document.getElementById(id);if(e)e.textContent=value;}
function selectMarket(name,symbol){selectedMarket={name,symbol};document.querySelectorAll(".market").forEach(c=>c.classList.toggle("active",c.dataset.symbol===symbol));setText("chart-title",name);setText("chart-message","Cargando historial real...");if(typeof openMarket==="function")openMarket(symbol);}
function addSignal(data){if(!data||signals.some(s=>s.symbol===data.symbol&&s.candleTime===data.candleTime&&s.direction===data.direction))return;signalCounter++;signals.unshift({id:"SIG-"+String(signalCounter).padStart(4,"0"),createdAt:Date.now(),status:"ACTIVE",...data});renderSignals();}
function markEntered(id){const s=signals.find(x=>x.id===id);if(!s||s.status!=="ACTIVE")return;s.status="ENTERED";operations.unshift({...s,enteredAt:Date.now(),currentPrice:Number(s.entry),result:"OPEN"});renderSignals();renderOperations();}
function markIgnored(id){const s=signals.find(x=>x.id===id);if(!s||s.status!=="ACTIVE")return;s.status="IGNORED";history.unshift({...s,result:"NO ENTRÉ",finishedAt:Date.now()});renderSignals();renderHistory();}
function signedMove(direction,from,to){return direction==="COMPRAR"?to-from:from-to;}
function profitLock(op){const risk=Math.abs(op.entry-op.sl);return op.direction==="COMPRAR"?op.entry+risk*0.5:op.entry-risk*0.5;}
function updateOperationPrice(symbol,price){operations.forEach(op=>{if(op.symbol!==symbol||op.result!=="OPEN")return;op.currentPrice=Number(price);const favorable=signedMove(op.direction,op.entry,price);if(!op.tp1Hit&&favorable>=Math.abs(op.tp1-op.entry)){op.tp1Hit=true;op.partialClosed=true;op.realizedR=(Number(op.tp1Close??50)/100)*(Math.abs(op.tp1-op.entry)/Math.abs(op.entry-op.sl));op.protectionActive=op.protectAfterTp1!==false;if(op.protectionActive)op.protectionSL=profitLock(op);op.managementMessage="TP1 ALCANZADO · 50% asegurado · SL restante en +0.5R";}if(op.tp1Hit&&favorable>=Math.abs(op.tp2-op.entry)){op.result="GANADA";op.exitPrice=Number(price);op.realizedR+=((100-Number(op.tp1Close??50))/100)*(Math.abs(op.tp2-op.entry)/Math.abs(op.entry-op.sl));op.exitReason="TP2 · OBJETIVO FINAL";op.finishedAt=Date.now();history.unshift({...op});}else if(op.tp1Hit&&(op.direction==="COMPRAR"?price<=op.protectionSL:price>=op.protectionSL)){op.result="GANADA";op.exitPrice=op.protectionSL;op.realizedR+=0.5*0.5;op.exitReason="PROTECCIÓN +0.5R · RESTO CERRADO";op.finishedAt=Date.now();history.unshift({...op});}});renderOperations();renderHistory();}
function isDoji(c){const range=c.high-c.low;if(range<=0)return false;return Math.abs(c.close-c.open)/range<=0.12;}
function evaluateOpenOperations(symbol,candle){operations.forEach(op=>{if(op.symbol!==symbol||op.result!=="OPEN"||op.lastManagedCandle===candle.time)return;op.lastManagedCandle=candle.time;const risk=Math.abs(op.entry-op.sl),hitTp1=op.direction==="COMPRAR"?candle.high>=op.tp1:candle.low<=op.tp1,hitTp2=op.direction==="COMPRAR"?candle.high>=op.tp2:candle.low<=op.tp2,hitStop=op.direction==="COMPRAR"?candle.low<= (op.protectionSL??op.sl):candle.high>=(op.protectionSL??op.sl);if(!op.tp1Hit&&hitStop){op.result="PERDIDA";op.exitPrice=op.sl;op.realizedR=-1;op.exitReason="SL INICIAL";op.finishedAt=candle.time*1000;history.unshift({...op});return;}if(!op.tp1Hit&&hitTp1){op.tp1Hit=true;op.partialClosed=true;op.realizedR=(Number(op.tp1Close??50)/100)*(Math.abs(op.tp1-op.entry)/risk);op.protectionActive=true;op.protectionSL=profitLock(op);op.managementMessage="TP1 ALCANZADO · CIERRA 50% · PROTEGE EL RESTO EN +0.5R";return;}if(op.tp1Hit){if(hitTp2){op.result="GANADA";op.exitPrice=op.tp2;op.realizedR+=((100-Number(op.tp1Close??50))/100)*(Math.abs(op.tp2-op.entry)/risk);op.exitReason="TP2 · OBJETIVO FINAL";op.finishedAt=candle.time*1000;history.unshift({...op});}else if(hitStop){op.result="GANADA";op.exitPrice=op.protectionSL;op.realizedR+=0.25;op.exitReason="PROTECCIÓN +0.5R";op.finishedAt=candle.time*1000;history.unshift({...op});}else{op.managementMessage="TP1 COBRADO · RESTO PROTEGIDO EN +0.5R";}}});renderOperations();renderHistory();}
function renderSignals(){const area=document.getElementById("signals");if(!area)return;const active=signals.filter(s=>s.status==="ACTIVE");setText("signal-count",active.length);area.innerHTML=active.length?active.map(s=>`<article class="signal-card"><div class="muted">${s.id} · ${s.market}</div><h3 class="${s.direction==="COMPRAR"?"buy":"sell"}">${s.direction}</h3><div class="levels"><div class="level"><span>ENTRADA</span><strong>${fmt(s.entry)}</strong></div><div class="level"><span>SL</span><strong>${fmt(s.sl)}</strong></div><div class="level"><span>TP1 ESTRUCTURAL</span><strong>${fmt(s.tp1)}</strong></div><div class="level"><span>TP2</span><strong>${fmt(s.tp2)}</strong></div></div><div class="muted">${s.mode||"RSI + EMA"} · RSI ${s.rsi.toFixed(1)} · EMA ${(s.emaPeriods||strategyConfig.emaPeriods).join("/")}</div><div class="action-row"><button class="enter-button" onclick="markEntered('${s.id}')">ENTRÉ</button><button class="ignore-button" onclick="markIgnored('${s.id}')">NO ENTRÉ</button></div></article>`).join(""):'<div class="empty-state">No hay señales activas.</div>';}
function renderOperations(){const area=document.getElementById("operations");if(!area)return;const open=operations.filter(x=>x.result==="OPEN");setText("operation-count",open.length);area.innerHTML=open.length?open.map(o=>`<article class="operation-card"><strong>${o.market} · ${o.direction}</strong><p>Entrada ${fmt(o.entry)} · Actual ${fmt(o.currentPrice)}</p><p>SL inicial ${fmt(o.sl)} · TP1 ${fmt(o.tp1)} · TP2 ${fmt(o.tp2)}</p>${o.tp1Hit?`<p class="result-warning">TP1: 50% COBRADO · SL RESTANTE: ${fmt(o.protectionSL)} (+0.5R)</p>`:`<p class="result-warning">${o.managementMessage||"EN SEGUIMIENTO · TP1 COBRA 50%"}</p>`}</article>`).join(""):'<div class="empty-state">No tienes operaciones manuales abiertas.</div>'; }
function renderHistory(){const a=document.getElementById("history");if(!a)return;a.innerHTML=history.length?history.slice(0,100).map(x=>`<article class="history-card"><strong>${x.market||""}</strong><p>${x.direction||""} · ${x.result}</p></article>`).join(""):'<div class="empty-state">Sin resultados registrados.</div>';}
function fmt(v){return Number(v).toPrecision(7).replace(/0+$/,"").replace(/\.$/,"");}
function emaAt(v,p,end=v.length-1){if(end+1<p)return null;let x=v.slice(0,p).reduce((a,b)=>a+b,0)/p,k=2/(p+1);for(let i=p;i<=end;i++)x=v[i]*k+x*(1-k);return x;}
function rsiSeries(values,period=14){const out=Array(values.length).fill(null);if(values.length<=period)return out;let gain=0,loss=0;for(let i=1;i<=period;i++){const d=values[i]-values[i-1];gain+=Math.max(0,d);loss+=Math.max(0,-d);}let ag=gain/period,al=loss/period;out[period]=al===0?100:100-100/(1+ag/al);for(let i=period+1;i<values.length;i++){const d=values[i]-values[i-1];ag=(ag*(period-1)+Math.max(0,d))/period;al=(al*(period-1)+Math.max(0,-d))/period;out[i]=al===0?100:100-100/(1+ag/al);}return out;}
const rsiConfig={timeframe:60,period:14,low:40,mid:50,high:60};
function aggregateRsiCandles(candles,seconds){
 if(seconds<=60)return candles.map((c,i)=>({...c,_sourceIndex:i}));
 const buckets=new Map();
 candles.forEach((c,i)=>{const key=Math.floor(c.time/seconds)*seconds;let b=buckets.get(key);if(!b){b={time:key,open:c.open,high:c.high,low:c.low,close:c.close,_sourceIndex:i};buckets.set(key,b);}else{b.high=Math.max(b.high,c.high);b.low=Math.min(b.low,c.low);b.close=c.close;b._sourceIndex=i;}});
 return [...buckets.values()].sort((a,b)=>a.time-b.time);
}
function configuredRsiSeries(candles){
 const period=Math.max(2,Math.min(200,Number(rsiConfig.period)||14)),seconds=Math.max(60,Number(rsiConfig.timeframe)||60);
 if(seconds===60)return rsiSeries(candles.map(c=>c.close),period);
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
document.addEventListener("DOMContentLoaded",()=>{["rsi-timeframe","rsi-period","rsi-low","rsi-mid","rsi-high","ema-periods","crt-lookback","sl-buffer","tp1-r","tp2-r","tp1-close","protect-after-tp1"].forEach(id=>{const e=document.getElementById(id);if(e)e.addEventListener("change",()=>{applyRsiSettings();readStrategySettings();});});});

function swingPoints(candles,at){const highs=[],lows=[];for(let i=2;i<at-2;i++){const c=candles[i];if(c.high>candles[i-1].high&&c.high>candles[i-2].high&&c.high>=candles[i+1].high&&c.high>=candles[i+2].high)highs.push({i,v:c.high});if(c.low<candles[i-1].low&&c.low<candles[i-2].low&&c.low<=candles[i+1].low&&c.low<=candles[i+2].low)lows.push({i,v:c.low});}return{highs,lows};}
const strategyConfig={emaPeriods:[9,20,50],structureLookback:20,slBufferAtr:.10,tp1R:1.5,tp2R:2.5,tp1Close:50,protectAfterTp1:true};
function readStrategySettings(){
 const e=document.getElementById("ema-periods");
 if(e){const nums=e.value.split(/[ ,;]+/).map(Number).filter(n=>Number.isInteger(n)&&n>=2&&n<=500);if(nums.length>=2)strategyConfig.emaPeriods=[...new Set(nums)].sort((x,y)=>x-y);}
 const cfg=[["crt-lookback","structureLookback",5,100,20],["sl-buffer","slBufferAtr",0,2,.1],["tp1-r","tp1R",.5,10,1.5],["tp2-r","tp2R",1,20,2.5],["tp1-close","tp1Close",1,99,50]];
 cfg.forEach(([id,key,min,max,def])=>{const el=document.getElementById(id);if(el)strategyConfig[key]=Math.max(min,Math.min(max,Number(el.value)||def));});
 const protect=document.getElementById("protect-after-tp1");if(protect)strategyConfig.protectAfterTp1=protect.checked;
 if(strategyConfig.tp2R<=strategyConfig.tp1R)strategyConfig.tp2R=strategyConfig.tp1R+.5;
 lastSignalKey="";if(m1Candles.length)runBacktest(backtestSymbol||selectedMarket?.symbol,selectedMarket?.name||"",m1Candles);
 if(selectedMarket&&m1Candles.length)analyzeCandles(selectedMarket.symbol,selectedMarket.name,m1Candles);
}
function strategyTrend(closes,i){
 const ps=strategyConfig.emaPeriods,now=ps.map(p=>emaAt(closes,p,i)),before=ps.map(p=>emaAt(closes,p,i-1));
 if(now.length<3||now.some(x=>x==null)||before.some(x=>x==null))return{bull:false,bear:false,now,before};
 const bull=now[0]>now[1]&&now[0]>before[0]&&now[1]>before[1]&&now[2]>=before[2]&&closes[i]>now[2];
 const bear=now[0]<now[1]&&now[0]<before[0]&&now[1]<before[1]&&now[2]<=before[2]&&closes[i]<now[2];
 return{bull,bear,now,before};
}
function rsiPullbackConfirmed(rsis,i,direction){
 const start=Math.max(2,i-35),high=rsiConfig.high,low=rsiConfig.low,mid=rsiConfig.mid;let breakout=-1,pullback=false;
 for(let k=start+1;k<i-1;k++){
  if(direction==="COMPRAR"&&rsis[k]!=null&&rsis[k-1]!=null&&rsis[k]>high&&rsis[k-1]<=high)breakout=k;
  if(direction==="VENDER"&&rsis[k]!=null&&rsis[k-1]!=null&&rsis[k]<low&&rsis[k-1]>=low)breakout=k;
 }
 if(breakout<0)return false;
 for(let k=breakout+1;k<i;k++){
  if(direction==="COMPRAR"&&rsis[k]!=null&&rsis[k]<=mid)pullback=true;
  if(direction==="VENDER"&&rsis[k]!=null&&rsis[k]>=low&&rsis[k]<=mid)pullback=true;
 }
 if(!pullback||rsis[i]==null||rsis[i-1]==null)return false;
 if(direction==="COMPRAR")return rsis[i]>=mid&&rsis[i]<=high+5&&rsis[i]>rsis[i-1];
 return rsis[i]>=low&&rsis[i]<=mid&&rsis[i]<rsis[i-1];
}
function buildSignal(candles,i,rsis){
 const required=Math.max(60,...strategyConfig.emaPeriods,14)+3;
 if(i<required||rsis[i]==null||rsis[i-1]==null)return null;
 const c=candles[i],r=rsis[i],closes=candles.slice(0,i+1).map(x=>x.close),trend=strategyTrend(closes,i);
 const pivots=swingPoints(candles,i),recent=candles.slice(Math.max(0,i-14),i+1);
 const atr=recent.reduce((sum,x)=>sum+x.high-x.low,0)/recent.length;
 if(!Number.isFinite(atr)||atr<=0)return null;
 const body=Math.abs(c.close-c.open),lowerWick=Math.min(c.open,c.close)-c.low,upperWick=c.high-Math.max(c.open,c.close);
 const support=[...pivots.lows].reverse().find(p=>i-p.i<=50&&p.v<c.close);
 const resistance=[...pivots.highs].reverse().find(p=>i-p.i<=50&&p.v>c.close);
 const buy=trend.bull&&rsiPullbackConfirmed(rsis,i,"COMPRAR")&&!!support&&c.low<=support.v+atr*.35&&c.low>=support.v-atr*.75&&c.close>support.v&&c.close>c.open&&lowerWick>=Math.max(body*.35,atr*.08);
 const sell=trend.bear&&rsiPullbackConfirmed(rsis,i,"VENDER")&&!!resistance&&c.high>=resistance.v-atr*.35&&c.high<=resistance.v+atr*.75&&c.close<resistance.v&&c.close<c.open&&upperWick>=Math.max(body*.35,atr*.08);
 if(!buy&&!sell)return null;
 const direction=buy?"COMPRAR":"VENDER",entry=c.close,buffer=atr*strategyConfig.slBufferAtr;
 const sl=buy?Math.min(c.low,support.v)-buffer:Math.max(c.high,resistance.v)+buffer;
 const risk=Math.abs(entry-sl);if(!Number.isFinite(risk)||risk<=0)return null;
 const prior=candles.slice(Math.max(0,i-100),i),swingTargets=buy?pivots.highs.map(p=>p.v):pivots.lows.map(p=>p.v);
 const structuralExtremes=[20,50,100].map(n=>{const window=candles.slice(Math.max(0,i-n),i);return buy?Math.max(...window.map(x=>x.high)):Math.min(...window.map(x=>x.low));});
 const levels=[...new Set([...swingTargets,...structuralExtremes].filter(v=>Number.isFinite(v)&& (buy?v>entry:v<entry)))].sort((a,b)=>buy?a-b:b-a);
 const min1=entry+(buy?1:-1)*risk*strategyConfig.tp1R,min2=entry+(buy?1:-1)*risk*strategyConfig.tp2R;
 const tp1=levels.find(v=>buy?v>=min1:v<=min1),tp2=levels.find(v=>buy?v>=min2&&v>tp1:v<=min2&&v<tp1);
 if(!Number.isFinite(tp1)||!Number.isFinite(tp2))return null;
 return{direction,entry,sl,tp1,tp2,rsi:r,time:c.time,index:i,mode:"EMA 9/20/50 · RSI 40/50/60 · ZIGZAG + REBOTE",support:support?.v,resistance:resistance?.v,emaPeriods:strategyConfig.emaPeriods.slice(),tp1Close:strategyConfig.tp1Close,protectAfterTp1:strategyConfig.protectAfterTp1};
}
function runBacktest(symbol,market,candles){
 if(!Array.isArray(candles)||candles.length<65)return;
 const data=candles.slice().sort((a,b)=>a.time-b.time),rs=configuredRsiSeries(data);backtestTrades.length=0;let active=null;
 for(let i=Math.max(60,...strategyConfig.emaPeriods,strategyConfig.structureLookback)+2;i<data.length-1;i++){
  const c=data[i];
  if(active){
   let exit=null;const stop=active.protectionSL??active.sl,hitStop=active.direction==="COMPRAR"?c.low<=stop:c.high>=stop,hitTp1=active.direction==="COMPRAR"?c.high>=active.tp1:c.low<=active.tp1,hitTp2=active.direction==="COMPRAR"?c.high>=active.tp2:c.low<=active.tp2,risk=Math.abs(active.entry-active.sl);
   if(!active.tp1Hit&&hitStop)exit={result:"PERDIDA",price:stop,reason:"SL INICIAL",realizedR:-1};
   else if(!active.tp1Hit&&hitTp1){active.tp1Hit=true;active.tp1Time=c.time*1000;active.protectAfterTp1=strategyConfig.protectAfterTp1;active.protectionActive=strategyConfig.protectAfterTp1;if(active.protectionActive)active.protectionSL=profitLock(active);active.realizedR=0.5*(Math.abs(active.tp1-active.entry)/risk);}
   else if(active.tp1Hit&&hitStop&&active.protectionActive!==false)exit={result:"GANADA",price:stop,reason:"PROTECCIÓN +0.5R",realizedR:active.realizedR+0.25};
   else if(active.tp1Hit&&hitTp2)exit={result:"GANADA",price:active.tp2,reason:"TP2",realizedR:active.realizedR+0.5*(Math.abs(active.tp2-active.entry)/risk)};
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
 setText("chart-message","Backtest M1 · RSI "+(rsiConfig.timeframe/60)+"m ("+rsiConfig.period+") · "+closed.length+" cerradas · "+rate+"% ganadas · TP1 "+tp1Hits+" · TP2 "+tp2Hits+" · "+losses+" pérdidas · TP1 cobra 50% (mín. 1.5R) · resto protegido +0.5R · TP2 (mín. 2.5R)");
}
function simulateCandidate(data,config,rsi){
 const oldS={...strategyConfig},oldR={...rsiConfig};Object.assign(strategyConfig,config);Object.assign(rsiConfig,rsi);
 const rs=configuredRsiSeries(data),trades=[];let active=null;
 for(let i=Math.max(60,...strategyConfig.emaPeriods,strategyConfig.structureLookback)+2;i<data.length-1;i++){
  const c=data[i];
  if(active){const stop=active.protectionSL??active.sl,hitStop=active.direction==="COMPRAR"?c.low<=stop:c.high>=stop,hit1=active.direction==="COMPRAR"?c.high>=active.tp1:c.low<=active.tp1,hit2=active.direction==="COMPRAR"?c.high>=active.tp2:c.low<=active.tp2,risk=Math.abs(active.entry-active.sl);let out=null;
   if(!active.tp1Hit&&hitStop)out={result:"PERDIDA",realizedR:-1};else if(!active.tp1Hit&&hit1){active.tp1Hit=true;active.realizedR=.5*Math.abs(active.tp1-active.entry)/risk;active.protectionSL=profitLock(active);}else if(active.tp1Hit&&hitStop&&active.protectionActive!==false)out={result:"GANADA",realizedR:active.realizedR+.25};else if(active.tp1Hit&&hit2)out={result:"GANADA",realizedR:active.realizedR+.5*Math.abs(active.tp2-active.entry)/risk};
   if(out){trades.push({...active,...out,exitIndex:i});active=null;}}
  if(!active){const s=buildSignal(data,i,rs);if(s)active={...s,entryIndex:i,tp1Hit:false};}
 }
 Object.assign(strategyConfig,oldS);Object.assign(rsiConfig,oldR);return trades;
}
function optimizeBacktest(){
 if(m1Candles.length<180){setText("optimizer-result","Necesito al menos 180 velas M1 para optimizar con validación.");return;}
 const data=m1Candles.slice().sort((a,b)=>a.time-b.time),split=Math.floor(data.length*.7),emaSets=[[9,20,50],[8,21,55],[10,20,50,100]],bbPeriods=[14,20,30],rsiPeriods=[10,14,21],levels=[[55,45],[60,40],[65,35]];let best=null,scored=0;
 for(const emas of emaSets)for(const bb of bbPeriods)for(const rp of rsiPeriods)for(const lv of levels)for(const useBB of [true,false]){
  const cfg={emaPeriods:emas,bollingerPeriod:bb,useBollinger:useBB},rc={...rsiConfig,period:rp,high:lv[0],low:lv[1],mid:50};const trades=simulateCandidate(data,cfg,rc),train=trades.filter(t=>t.entryIndex<split),valid=trades.filter(t=>t.entryIndex>=split);
  const metric=list=>{const wins=list.filter(t=>t.result==="GANADA").length;return{n:list.length,wr:list.length?wins/list.length*100:0,net:list.reduce((s,t)=>s+(t.realizedR||0),0)};};const tr=metric(train),va=metric(valid);if(tr.n<5||va.n<5||va.net<=0)continue;scored++;
  const score=va.net+Math.min(va.wr,75)*.015+Math.min(va.n,30)*.03;if(!best||score>best.score)best={score,cfg,rc,tr,va};
 }
 if(!best){setText("optimizer-result","Muestra insuficiente: no hubo combinaciones con al menos 5 operaciones cerradas en entrenamiento y 5 en validación. Carga más historial.");return;}
 Object.assign(strategyConfig,best.cfg);Object.assign(rsiConfig,best.rc);
 const e=document.getElementById("ema-periods"),b=document.getElementById("bb-period"),on=document.getElementById("bb-enabled"),rp=document.getElementById("rsi-period"),lo=document.getElementById("rsi-low"),hi=document.getElementById("rsi-high");if(e)e.value=best.cfg.emaPeriods.join(",");if(b)b.value=best.cfg.bollingerPeriod;if(on)on.checked=best.cfg.useBollinger;if(rp)rp.value=best.rc.period;if(lo)lo.value=best.rc.low;if(hi)hi.value=best.rc.high;
 lastSignalKey="";runBacktest(backtestSymbol||selectedMarket?.symbol,selectedMarket?.name||"",data);if(selectedMarket)analyzeCandles(selectedMarket.symbol,selectedMarket.name,data);
 setText("optimizer-result","Mejor combinación entre "+scored+" configuraciones · EMA "+best.cfg.emaPeriods.join("/")+" · Bollinger "+(best.cfg.useBollinger?"ON":"OFF")+" ("+best.cfg.bollingerPeriod+") · RSI "+best.rc.period+" ("+best.rc.low+"/"+best.rc.high+"). Entrenamiento: "+best.tr.n+" ops, "+best.tr.wr.toFixed(1)+"% acierto, "+best.tr.net.toFixed(2)+"R. Validación 30%: "+best.va.n+" ops, "+best.va.wr.toFixed(1)+"% acierto, "+best.va.net.toFixed(2)+"R. Parámetros aplicados a señales y backtest.");
}
function drawRsiPanel(series,candles){const host=document.getElementById("rsi-area");if(!host)return;host.innerHTML="";const cv=document.createElement("canvas");cv.style.cssText="width:100%;height:100%;display:block";host.appendChild(cv);const dpr=Math.min(devicePixelRatio||1,2),w=host.clientWidth,h=host.clientHeight;cv.width=w*dpr;cv.height=h*dpr;const x=cv.getContext("2d");x.scale(dpr,dpr);const left=24,right=8,top=10,bottom=18,ph=h-top-bottom,pw=w-left-right;for(const level of [rsiConfig.low,rsiConfig.mid,rsiConfig.high]){const y=top+(100-level)/100*ph;x.strokeStyle=level===50?"#8495aa":"#43546b";x.setLineDash([4,3]);x.beginPath();x.moveTo(left,y);x.lineTo(w-right,y);x.stroke();x.setLineDash([]);x.fillStyle="#a8b5c6";x.font="9px Arial";x.fillText(String(level),2,y+3);}const start=Math.max(0,series.length-200);x.beginPath();let begun=false;for(let i=start;i<series.length;i++){if(series[i]==null)continue;const px=left+(i-start)/Math.max(1,series.length-start-1)*pw,py=top+(100-series[i])/100*ph;if(!begun){x.moveTo(px,py);begun=true;}else x.lineTo(px,py);}x.strokeStyle="#48a8ff";x.lineWidth=1.7;x.stroke();setText("rsi-current","RSI: "+(series.at(-1)==null?"--":series.at(-1).toFixed(1)));}
function analyzeCandles(symbol,market,candles){if(!candles||candles.length<61)return;const closedIndex=candles.length-2;evaluateOpenOperations(symbol,candles[closedIndex]);const rs=configuredRsiSeries(candles),s=buildSignal(candles,closedIndex,rs);drawRsiPanel(rs,candles);if(!s)return;const key=symbol+":"+s.time+":"+s.direction;if(key===lastSignalKey)return;lastSignalKey=key;addSignal({...s,symbol,market,quality:80,candleTime:s.time});if(typeof drawTradeLevels==="function")drawTradeLevels(s);}
function setAnalysisGranularity(seconds){analysisGranularity=60;lastSignalKey="";backtestTrades.length=0;backtestReady=false;}
function setBacktestHistory(symbol,market,candles){if(!candles||!candles.length)return;m1Candles=candles.slice();runBacktest(symbol,market,m1Candles);}
function updateBacktestTick(epoch,price){if(!Number.isFinite(epoch)||!Number.isFinite(price)||!m1Candles.length)return;const interval=60,bucket=Math.floor(epoch/interval)*interval,last=m1Candles.at(-1);if(last&&last.time===bucket){m1Candles[m1Candles.length-1]={...last,high:Math.max(last.high,price),low:Math.min(last.low,price),close:price};return;}if(!last||bucket>last.time){m1Candles.push({time:bucket,open:price,high:price,low:price,close:price});runBacktest(backtestSymbol||selectedMarket?.symbol,selectedMarket?.name||"",m1Candles);}}
document.addEventListener("DOMContentLoaded",()=>{if(typeof createMarketChart==="function")createMarketChart();updateDailyPanel();setInterval(updateDailyPanel,1000);});
