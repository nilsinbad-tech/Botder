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
function signedMove(direction,from,to){return direction==="COMPRAR"?to-from:from-to;}
function profitLock(op){const risk=Math.abs(op.entry-op.sl);return op.direction==="COMPRAR"?op.entry+risk*0.5:op.entry-risk*0.5;}
function updateOperationPrice(symbol,price){operations.forEach(op=>{if(op.symbol!==symbol||op.result!=="OPEN")return;op.currentPrice=Number(price);const favorable=signedMove(op.direction,op.entry,price);if(!op.tp1Hit&&favorable>=Math.abs(op.tp1-op.entry)){op.tp1Hit=true;op.partialClosed=true;op.realizedR=0.5*(Math.abs(op.tp1-op.entry)/Math.abs(op.entry-op.sl));op.protectionActive=true;op.protectionSL=profitLock(op);op.managementMessage="TP1 ALCANZADO · 50% asegurado · SL restante en +0.5R";}if(op.tp1Hit&&favorable>=Math.abs(op.tp2-op.entry)){op.result="GANADA";op.exitPrice=Number(price);op.realizedR+=0.5*(Math.abs(op.tp2-op.entry)/Math.abs(op.entry-op.sl));op.exitReason="TP2 · OBJETIVO FINAL";op.finishedAt=Date.now();history.unshift({...op});}else if(op.tp1Hit&&(op.direction==="COMPRAR"?price<=op.protectionSL:price>=op.protectionSL)){op.result="GANADA";op.exitPrice=op.protectionSL;op.realizedR+=0.5*0.5;op.exitReason="PROTECCIÓN +0.5R · RESTO CERRADO";op.finishedAt=Date.now();history.unshift({...op});}});renderOperations();renderHistory();}
function isDoji(c){const range=c.high-c.low;if(range<=0)return false;return Math.abs(c.close-c.open)/range<=0.12;}
function evaluateOpenOperations(symbol,candle){operations.forEach(op=>{if(op.symbol!==symbol||op.result!=="OPEN"||op.lastManagedCandle===candle.time)return;op.lastManagedCandle=candle.time;const risk=Math.abs(op.entry-op.sl),hitTp1=op.direction==="COMPRAR"?candle.high>=op.tp1:candle.low<=op.tp1,hitTp2=op.direction==="COMPRAR"?candle.high>=op.tp2:candle.low<=op.tp2,hitStop=op.direction==="COMPRAR"?candle.low<= (op.protectionSL??op.sl):candle.high>=(op.protectionSL??op.sl);if(!op.tp1Hit&&hitStop){op.result="PERDIDA";op.exitPrice=op.sl;op.realizedR=-1;op.exitReason="SL INICIAL";op.finishedAt=candle.time*1000;history.unshift({...op});return;}if(!op.tp1Hit&&hitTp1){op.tp1Hit=true;op.partialClosed=true;op.realizedR=0.5*(Math.abs(op.tp1-op.entry)/risk);op.protectionActive=true;op.protectionSL=profitLock(op);op.managementMessage="TP1 ALCANZADO · CIERRA 50% · PROTEGE EL RESTO EN +0.5R";return;}if(op.tp1Hit){if(hitTp2){op.result="GANADA";op.exitPrice=op.tp2;op.realizedR+=0.5*(Math.abs(op.tp2-op.entry)/risk);op.exitReason="TP2 · OBJETIVO FINAL";op.finishedAt=candle.time*1000;history.unshift({...op});}else if(hitStop){op.result="GANADA";op.exitPrice=op.protectionSL;op.realizedR+=0.25;op.exitReason="PROTECCIÓN +0.5R";op.finishedAt=candle.time*1000;history.unshift({...op});}else{op.managementMessage="TP1 COBRADO · RESTO PROTEGIDO EN +0.5R";}}});renderOperations();renderHistory();}
function renderSignals(){const area=document.getElementById("signals");if(!area)return;const active=signals.filter(s=>s.status==="ACTIVE");setText("signal-count",active.length);area.innerHTML=active.length?active.map(s=>`<article class="signal-card"><div class="muted">${s.id} · ${s.market}</div><h3 class="${s.direction==="COMPRAR"?"buy":"sell"}">${s.direction}</h3><div class="levels"><div class="level"><span>ENTRADA</span><strong>${fmt(s.entry)}</strong></div><div class="level"><span>SL</span><strong>${fmt(s.sl)}</strong></div><div class="level"><span>TP1 ESTRUCTURAL</span><strong>${fmt(s.tp1)}</strong></div><div class="level"><span>TP2</span><strong>${fmt(s.tp2)}</strong></div></div><div class="muted">${s.mode||"RSI + EMA"} · RSI ${s.rsi.toFixed(1)} · EMA ${(s.emaPeriods||strategyConfig.emaPeriods).join("/")}</div><div class="action-row"><button class="enter-button" onclick="markEntered('${s.id}')">ENTRÉ</button><button class="ignore-button" onclick="markIgnored('${s.id}')">NO ENTRÉ</button></div></article>`).join(""):'<div class="empty-state">No hay señales activas.</div>';}
function renderOperations(){const area=document.getElementById("operations");if(!area)return;const open=operations.filter(x=>x.result==="OPEN");setText("operation-count",open.length);area.innerHTML=open.length?open.map(o=>`<article class="operation-card"><strong>${o.market} · ${o.direction}</strong><p>Entrada ${fmt(o.entry)} · Actual ${fmt(o.currentPrice)}</p><p>SL inicial ${fmt(o.sl)} · TP1 ${fmt(o.tp1)} · TP2 ${fmt(o.tp2)}</p>${o.tp1Hit?`<p class="result-warning">TP1: 50% COBRADO · SL RESTANTE: ${fmt(o.protectionSL)} (+0.5R)</p>`:`<p class="result-warning">${o.managementMessage||"EN SEGUIMIENTO · TP1 COBRA 50%"}</p>`}</article>`).join(""):'<div class="empty-state">No tienes operaciones manuales abiertas.</div>'; }
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
document.addEventListener("DOMContentLoaded",()=>{["rsi-timeframe","rsi-period","rsi-low","rsi-mid","rsi-high","ema-periods","bb-period","bb-enabled"].forEach(id=>{const e=document.getElementById(id);if(e)e.addEventListener("change",()=>{applyRsiSettings();readStrategySettings();});});});

function swingPoints(candles,at){const highs=[],lows=[];for(let i=2;i<at-2;i++){const c=candles[i];if(c.high>candles[i-1].high&&c.high>candles[i-2].high&&c.high>=candles[i+1].high&&c.high>=candles[i+2].high)highs.push({i,v:c.high});if(c.low<candles[i-1].low&&c.low<candles[i-2].low&&c.low<=candles[i+1].low&&c.low<=candles[i+2].low)lows.push({i,v:c.low});}return{highs,lows};}
const strategyConfig={emaPeriods:[9,20,50],bollingerPeriod:20,useBollinger:true};
function readStrategySettings(){
 const e=document.getElementById("ema-periods"),b=document.getElementById("bb-period"),on=document.getElementById("bb-enabled");
 if(e){const nums=e.value.split(/[ ,;]+/).map(Number).filter(n=>Number.isInteger(n)&&n>=2&&n<=500);if(nums.length>=2)strategyConfig.emaPeriods=[...new Set(nums)].sort((x,y)=>x-y);}
 if(b)strategyConfig.bollingerPeriod=Math.max(2,Math.min(500,Number(b.value)||20));
 if(on)strategyConfig.useBollinger=on.checked;
 lastSignalKey="";
 if(m1Candles.length)runBacktest(backtestSymbol||selectedMarket?.symbol,selectedMarket?.name||"",m1Candles);
 if(selectedMarket&&m1Candles.length)analyzeCandles(selectedMarket.symbol,selectedMarket.name,m1Candles);
}
function strategyTrend(closes,i){
 const ps=strategyConfig.emaPeriods,now=ps.map(p=>emaAt(closes,p,i)),before=ps.map(p=>emaAt(closes,p,i-1));
 if(now.some(x=>x==null)||before.some(x=>x==null))return{bull:false,bear:false};
 const bull=now.every((v,k)=>k===0||v>now[k-1])&&now.every((v,k)=>v>before[k]);
 const bear=now.every((v,k)=>k===0||v<now[k-1])&&now.every((v,k)=>v<before[k]);
 return{bull,bear};
}
function bollingerBasis(values,period,end=values.length-1){if(end+1<period)return null;return values.slice(end-period+1,end+1).reduce((a,b)=>a+b,0)/period;}
function buildSignal(candles,i,rsis){
 const required=Math.max(60,...strategyConfig.emaPeriods,strategyConfig.bollingerPeriod)+2;
 if(i<required||rsis[i]==null||rsis[i-1]==null)return null;
 const closes=candles.slice(0,i+1).map(c=>c.close),c=candles[i],prevC=candles[i-1],r=rsis[i],prev=rsis[i-1],trend=strategyTrend(closes,i);
 const rsiBuy=prev<rsiConfig.high&&r>=rsiConfig.high&&trend.bull,rsiSell=prev>rsiConfig.low&&r<=rsiConfig.low&&trend.bear;
 const basis=bollingerBasis(closes,strategyConfig.bollingerPeriod,i),prevBasis=bollingerBasis(closes,strategyConfig.bollingerPeriod,i-1);
 const bbBuy=strategyConfig.useBollinger&&basis!=null&&prevBasis!=null&&prevC.close<=prevBasis&&c.close>basis&&trend.bull;
 const bbSell=strategyConfig.useBollinger&&basis!=null&&prevBasis!=null&&prevC.close>=prevBasis&&c.close<basis&&trend.bear;
 const sw=swingPoints(candles,i),body=Math.abs(c.close-c.open),range=Math.max(c.high-c.low,1e-12),lowerWick=Math.min(c.open,c.close)-c.low,upperWick=c.high-Math.max(c.open,c.close);
 const recent=candles.slice(Math.max(0,i-14),i),atr=recent.length?recent.reduce((sum,x)=>sum+(x.high-x.low),0)/recent.length:range,tolerance=Math.max(atr*0.18,range*0.08);
 const priorHighs=sw.highs.filter(x=>x.i<i),priorLows=sw.lows.filter(x=>x.i<i);
 const support=priorLows.filter(x=>c.low<=x.v+tolerance&&c.close>x.v).at(-1),resistance=priorHighs.filter(x=>c.high>=x.v-tolerance&&c.close<x.v).at(-1);
 const lastHighs=priorHighs.slice(-2),lastLows=priorLows.slice(-2);
 const bullishStructure=lastHighs.length===2&&lastLows.length===2&&lastHighs[1].v>lastHighs[0].v&&lastLows[1].v>lastLows[0].v;
 const bearishStructure=lastHighs.length===2&&lastLows.length===2&&lastHighs[1].v<lastHighs[0].v&&lastLows[1].v<lastLows[0].v;
 const structuralBuy=!!support&&bullishStructure&&c.close>c.open&&lowerWick>=Math.max(body*1.2,range*0.18)&&r>prev&&trend.bull;
 const structuralSell=!!resistance&&bearishStructure&&c.close<c.open&&upperWick>=Math.max(body*1.2,range*0.18)&&r<prev&&trend.bear;
 // Ningún disparador opera aislado: RSI/Bollinger también necesitan estructura HH+HL o LH+LL.
 const validRsiBuy=rsiBuy&&bullishStructure,validRsiSell=rsiSell&&bearishStructure;
 const validBbBuy=bbBuy&&bullishStructure,validBbSell=bbSell&&bearishStructure;
 let direction,mode,entry=c.close,sl,tp1,tp2;
 if(validRsiBuy||validBbBuy||validRsiSell||validBbSell){direction=(validRsiBuy||validBbBuy)?"COMPRAR":"VENDER";mode=[validRsiBuy||validRsiSell?"RSI":null,validBbBuy||validBbSell?"BOLLINGER CENTRAL":null,"ESTRUCTURA "+((validRsiBuy||validBbBuy)?"HH + HL":"LH + LL"),"EMA"].filter(Boolean).join(" + ");}
 else if(structuralBuy||structuralSell){direction=structuralBuy?"VENDER":"COMPRAR";mode="REBOTE ESTRUCTURAL INVERTIDO";}
 else return null;
 if(direction==="COMPRAR"){
  const lows=sw.lows.filter(x=>x.i<i&&x.v<entry),highs=sw.highs.filter(x=>x.i<i&&x.v>entry);
  sl=lows.length?lows.at(-1).v:Math.min(...candles.slice(Math.max(0,i-7),i+1).map(x=>x.low));
  tp1=structuralSell?resistance?.v:undefined;
  const risk=entry-sl;tp2=highs.filter(x=>x.v>=entry+risk*2.5&&x.v>(tp1??entry)).map(x=>x.v).sort((x,y)=>x-y)[0];
 }else{
  const highs=sw.highs.filter(x=>x.i<i&&x.v>entry),lows=sw.lows.filter(x=>x.i<i&&x.v<entry);
  sl=highs.length?highs.at(-1).v:Math.max(...candles.slice(Math.max(0,i-7),i+1).map(x=>x.high));
  tp1=structuralBuy?support?.v:undefined;
  const risk=sl-entry;tp2=lows.filter(x=>x.v<=entry-risk*2.5&&x.v<(tp1??entry)).map(x=>x.v).sort((x,y)=>y-x)[0];
 }
 const risk=Math.abs(entry-sl);
 if(!Number.isFinite(tp1)){if(direction==="COMPRAR")tp1=sw.highs.filter(x=>x.i<i&&x.v>=entry+risk*1.5).map(x=>x.v).sort((x,y)=>x-y)[0];else tp1=sw.lows.filter(x=>x.i<i&&x.v<=entry-risk*1.5).map(x=>x.v).sort((x,y)=>y-x)[0];}
 if(!Number.isFinite(tp2)){if(direction==="COMPRAR")tp2=sw.highs.filter(x=>x.i<i&&x.v>=entry+risk*2.5&&x.v>tp1).map(x=>x.v).sort((x,y)=>x-y)[0];else tp2=sw.lows.filter(x=>x.i<i&&x.v<=entry-risk*2.5&&x.v<tp1).map(x=>x.v).sort((x,y)=>y-x)[0];}
 if(!Number.isFinite(sl)||!Number.isFinite(tp1)||!Number.isFinite(tp2)||(direction==="COMPRAR"?(sl>=entry||tp1<=entry||tp2<=tp1):(sl<=entry||tp1>=entry||tp2>=tp1)))return null;
 return{direction,entry,sl,tp1,tp2,rsi:r,time:c.time,index:i,mode,structuralLevel:structuralBuy?support?.v:structuralSell?resistance?.v:null,emaPeriods:strategyConfig.emaPeriods.slice(),bollingerPeriod:strategyConfig.bollingerPeriod};
}
function runBacktest(symbol,market,candles){
 if(!Array.isArray(candles)||candles.length<65)return;
 const data=candles.slice().sort((a,b)=>a.time-b.time),rs=configuredRsiSeries(data);backtestTrades.length=0;let active=null;
 for(let i=Math.max(60,...strategyConfig.emaPeriods,strategyConfig.bollingerPeriod)+2;i<data.length-1;i++){
  const c=data[i];
  if(active){
   let exit=null;const stop=active.protectionSL??active.sl,hitStop=active.direction==="COMPRAR"?c.low<=stop:c.high>=stop,hitTp1=active.direction==="COMPRAR"?c.high>=active.tp1:c.low<=active.tp1,hitTp2=active.direction==="COMPRAR"?c.high>=active.tp2:c.low<=active.tp2,risk=Math.abs(active.entry-active.sl);
   if(!active.tp1Hit&&hitStop)exit={result:"PERDIDA",price:stop,reason:"SL INICIAL",realizedR:-1};
   else if(!active.tp1Hit&&hitTp1){active.tp1Hit=true;active.tp1Time=c.time*1000;active.protectionSL=profitLock(active);active.realizedR=0.5*(Math.abs(active.tp1-active.entry)/risk);}
   else if(active.tp1Hit&&hitStop)exit={result:"GANADA",price:stop,reason:"PROTECCIÓN +0.5R",realizedR:active.realizedR+0.25};
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
 for(let i=Math.max(60,...strategyConfig.emaPeriods,strategyConfig.bollingerPeriod)+2;i<data.length-1;i++){
  const c=data[i];
  if(active){const stop=active.protectionSL??active.sl,hitStop=active.direction==="COMPRAR"?c.low<=stop:c.high>=stop,hit1=active.direction==="COMPRAR"?c.high>=active.tp1:c.low<=active.tp1,hit2=active.direction==="COMPRAR"?c.high>=active.tp2:c.low<=active.tp2,risk=Math.abs(active.entry-active.sl);let out=null;
   if(!active.tp1Hit&&hitStop)out={result:"PERDIDA",realizedR:-1};else if(!active.tp1Hit&&hit1){active.tp1Hit=true;active.realizedR=.5*Math.abs(active.tp1-active.entry)/risk;active.protectionSL=profitLock(active);}else if(active.tp1Hit&&hitStop)out={result:"GANADA",realizedR:active.realizedR+.25};else if(active.tp1Hit&&hit2)out={result:"GANADA",realizedR:active.realizedR+.5*Math.abs(active.tp2-active.entry)/risk};
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
  const metric=list=>{const wins=list.filter(t=>t.result==="GANADA").length;return{n:list.length,wr:list.length?wins/list.length*100:0,net:list.reduce((s,t)=>s+(t.realizedR||0),0)};};const tr=metric(train),va=metric(valid);if(tr.n<5||va.n<5)continue;scored++;
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
