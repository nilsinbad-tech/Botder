const signals=[],operations=[],history=[],backtestTrades=[];
let signalCounter=0,lastSignalKey="",selectedMarket=null,backtestSymbol=null,m1Candles=[],backtestReady=false;
const usedStructureKeys=new Set();
const TZ="America/Panama";
function panamaParts(ts=Date.now()){const p=new Intl.DateTimeFormat("en-CA",{timeZone:TZ,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date(ts));return Object.fromEntries(p.map(x=>[x.type,x.value]));}
function panamaDay(ts){const p=panamaParts(ts);return p.year+"-"+p.month+"-"+p.day;}
function updateDailyPanel(){const now=new Date(),date=panamaDay(now.getTime());const clock=new Intl.DateTimeFormat("es-PA",{timeZone:TZ,hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false}).format(now);const label=new Intl.DateTimeFormat("es-PA",{timeZone:TZ,day:"2-digit",month:"2-digit",year:"numeric"}).format(now);const c=document.getElementById("panama-clock");if(c)c.textContent=clock+" · "+label;const today=backtestTrades.filter(t=>panamaDay(t.exitTime||t.entryTime)===date);const wins=today.filter(t=>t.result==="GANADA").length,losses=today.filter(t=>t.result==="PERDIDA").length,total=wins+losses;setText("daily-wins",wins);setText("daily-losses",losses);setText("daily-total",total);setText("daily-rate",total?(wins/total*100).toFixed(1)+"%":"0%");setText("daily-date",date);}
function setText(id,value){const e=document.getElementById(id);if(e)e.textContent=value;}
function selectMarket(name,symbol){selectedMarket={name,symbol};document.querySelectorAll(".market").forEach(c=>c.classList.toggle("active",c.dataset.symbol===symbol));setText("chart-title",name);setText("chart-message","Cargando historial real...");if(typeof openMarket==="function")openMarket(symbol);}
function addSignal(data){if(!data)return;const structureKey=data.structureKey||"";if(signals.some(s=>s.symbol===data.symbol&&s.direction===data.direction&&(structureKey?s.structureKey===structureKey:s.candleTime===data.candleTime)))return;if(structureKey&&usedStructureKeys.has(structureKey))return;if(structureKey)usedStructureKeys.add(structureKey);signalCounter++;signals.unshift({id:"SIG-"+String(signalCounter).padStart(4,"0"),createdAt:Date.now(),status:"ACTIVE",...data});renderSignals();}
function markEntered(id){const s=signals.find(x=>x.id===id);if(!s||s.status!=="ACTIVE")return;s.status="ENTERED";operations.unshift({...s,enteredAt:Date.now(),currentPrice:Number(s.entry),result:"OPEN"});renderSignals();renderOperations();}
function markIgnored(id){const s=signals.find(x=>x.id===id);if(!s||s.status!=="ACTIVE")return;s.status="IGNORED";history.unshift({...s,result:"NO ENTRÉ",finishedAt:Date.now()});renderSignals();renderHistory();}
function signedMove(direction,from,to){return direction==="COMPRAR"?to-from:from-to;}
function profitLock(op){const risk=Math.abs(op.entry-op.sl);return op.direction==="COMPRAR"?op.entry+risk*0.5:op.entry-risk*0.5;}
function updateOperationPrice(symbol,price){operations.forEach(op=>{if(op.symbol!==symbol||op.result!=="OPEN")return;op.currentPrice=Number(price);if(op.singleTarget){const hitStop=op.direction==="COMPRAR"?price<=op.sl:price>=op.sl,hitTarget=op.direction==="COMPRAR"?price>=op.tp1:price<=op.tp1;if(hitStop||hitTarget){op.result=hitStop?"PERDIDA":"GANADA";op.exitPrice=hitStop?op.sl:op.tp1;op.exitReason=hitStop?"SL INICIAL":"TP ESTRUCTURAL";op.finishedAt=Date.now();history.unshift({...op});}return;}const favorable=signedMove(op.direction,op.entry,price);if(!op.tp1Hit&&favorable>=Math.abs(op.tp1-op.entry)){op.tp1Hit=true;op.partialClosed=true;op.realizedR=(Number(op.tp1Close??50)/100)*(Math.abs(op.tp1-op.entry)/Math.abs(op.entry-op.sl));op.protectionActive=op.protectAfterTp1!==false;if(op.protectionActive)op.protectionSL=profitLock(op);op.managementMessage="TP1 ALCANZADO · 50% asegurado · SL restante en +0.5R";}if(op.tp1Hit&&favorable>=Math.abs(op.tp2-op.entry)){op.result="GANADA";op.exitPrice=Number(price);op.realizedR+=((100-Number(op.tp1Close??50))/100)*(Math.abs(op.tp2-op.entry)/Math.abs(op.entry-op.sl));op.exitReason="TP2 · OBJETIVO FINAL";op.finishedAt=Date.now();history.unshift({...op});}else if(op.tp1Hit&&(op.direction==="COMPRAR"?price<=op.protectionSL:price>=op.protectionSL)){op.result="GANADA";op.exitPrice=op.protectionSL;op.realizedR+=0.5*0.5;op.exitReason="PROTECCIÓN +0.5R · RESTO CERRADO";op.finishedAt=Date.now();history.unshift({...op});}});renderOperations();renderHistory();}
function isDoji(c){const range=c.high-c.low;if(range<=0)return false;return Math.abs(c.close-c.open)/range<=0.12;}
function evaluateOpenOperations(symbol,candle){operations.forEach(op=>{if(op.symbol!==symbol||op.result!=="OPEN"||op.lastManagedCandle===candle.time)return;op.lastManagedCandle=candle.time;if(op.singleTarget){const hitStop=op.direction==="COMPRAR"?candle.low<=op.sl:candle.high>=op.sl,hitTarget=op.direction==="COMPRAR"?candle.high>=op.tp1:candle.low<=op.tp1;if(hitStop||hitTarget){op.result=hitStop?"PERDIDA":"GANADA";op.exitPrice=hitStop?op.sl:op.tp1;op.exitReason=hitStop?"SL INICIAL":"TP ESTRUCTURAL";op.finishedAt=candle.time*1000;history.unshift({...op});}return;}const risk=Math.abs(op.entry-op.sl),hitTp1=op.direction==="COMPRAR"?candle.high>=op.tp1:candle.low<=op.tp1,hitTp2=op.direction==="COMPRAR"?candle.high>=op.tp2:candle.low<=op.tp2,hitStop=op.direction==="COMPRAR"?candle.low<= (op.protectionSL??op.sl):candle.high>=(op.protectionSL??op.sl);if(!op.tp1Hit&&hitStop){op.result="PERDIDA";op.exitPrice=op.sl;op.realizedR=-1;op.exitReason="SL INICIAL";op.finishedAt=candle.time*1000;history.unshift({...op});return;}if(!op.tp1Hit&&hitTp1){op.tp1Hit=true;op.partialClosed=true;op.realizedR=(Number(op.tp1Close??50)/100)*(Math.abs(op.tp1-op.entry)/risk);op.protectionActive=true;op.protectionSL=profitLock(op);op.managementMessage="TP1 ALCANZADO · CIERRA 50% · PROTEGE EL RESTO EN +0.5R";return;}if(op.tp1Hit){if(hitTp2){op.result="GANADA";op.exitPrice=op.tp2;op.realizedR+=((100-Number(op.tp1Close??50))/100)*(Math.abs(op.tp2-op.entry)/risk);op.exitReason="TP2 · OBJETIVO FINAL";op.finishedAt=candle.time*1000;history.unshift({...op});}else if(hitStop){op.result="GANADA";op.exitPrice=op.protectionSL;op.realizedR+=0.25;op.exitReason="PROTECCIÓN +0.5R";op.finishedAt=candle.time*1000;history.unshift({...op});}else{op.managementMessage="TP1 COBRADO · RESTO PROTEGIDO EN +0.5R";}}});renderOperations();renderHistory();}
function renderSignals(){
 const active=signals.filter(s=>s.status==="ACTIVE");setText("signal-count",active.length);
 const safe=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 const markup=active.length?active.map(s=>'<article class="signal-card"><div class="muted">'+safe(s.id)+' · '+safe(s.market)+'</div><h3 class="'+(s.direction==="COMPRAR"?"buy":"sell")+'">'+safe(s.direction)+'</h3><div class="levels"><div class="level"><span>ENTRADA</span><strong>'+fmt(s.entry)+'</strong></div><div class="level"><span>STOP LOSS</span><strong>'+fmt(s.sl)+'</strong></div><div class="level"><span>TAKE PROFIT</span><strong>'+fmt(s.tp1)+'</strong></div></div><div class="muted">'+safe(s.mode||"Estructura de 3 toques")+' · '+safe(s.timeframe||"")+'</div><div class="action-row"><button class="enter-button" onclick="markEntered(\''+safe(s.id)+'\')">ENTRÉ</button><button class="ignore-button" onclick="markIgnored(\''+safe(s.id)+'\')">NO ENTRÉ</button></div></article>').join(""):'<div class="empty-state">Todavía no hay señales confirmadas.</div>';
 ["signals-top","signals-sidebar","signals"].forEach(id=>{const area=document.getElementById(id);if(area)area.innerHTML=markup;});
}
function renderOperations(){const area=document.getElementById("operations");if(!area)return;const open=operations.filter(x=>x.result==="OPEN");setText("operation-count",open.length);area.innerHTML=open.length?open.map(o=>'<article class="operation-card"><strong>'+o.market+' · '+o.direction+'</strong><p>Entrada '+fmt(o.entry)+' · Actual '+fmt(o.currentPrice)+'</p><p>SL '+fmt(o.sl)+' · TP '+fmt(o.singleTarget?o.tp1:o.tp2)+'</p><p class="result-warning">EN SEGUIMIENTO · REGISTRO DE SEÑAL MANUAL</p></article>').join(""):'<div class="empty-state">No hay operaciones manuales abiertas.</div>';}
function renderHistory(){renderStrategyJournal();}
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
 
 if(selectedMarket&&typeof openMarket==="function")analyzeCandles(selectedMarket.symbol,selectedMarket.name,m1Candles);
}
document.addEventListener("DOMContentLoaded",()=>{["rsi-timeframe","rsi-period","rsi-low","rsi-mid","rsi-high","ema-periods","crt-lookback","sl-buffer","tp1-r","tp2-r","tp1-close","protect-after-tp1"].forEach(id=>{const e=document.getElementById(id);if(e)e.addEventListener("change",()=>{applyRsiSettings();readStrategySettings();});});});


const strategyConfig={emaPeriods:[9,20,50],rsiPeriod:14};

let analysisGranularity=60,lastProjection=null,lastProjectionNotice="",cachedStructureItems=[];
function emaSeries(v,p){const o=Array(v.length).fill(null);if(v.length<p)return o;let e=v.slice(0,p).reduce((a,b)=>a+b,0)/p,k=2/(p+1);o[p-1]=e;for(let i=p;i<v.length;i++){e=v[i]*k+e*(1-k);o[i]=e;}return o;}
function rsiSeries(v,p=14){const o=Array(v.length).fill(null);if(v.length<=p)return o;let g=0,l=0;for(let i=1;i<=p;i++){let d=v[i]-v[i-1];g+=Math.max(0,d);l+=Math.max(0,-d);}let ag=g/p,al=l/p;o[p]=al===0?100:100-100/(1+ag/al);for(let i=p+1;i<v.length;i++){let d=v[i]-v[i-1];ag=(ag*(p-1)+Math.max(0,d))/p;al=(al*(p-1)+Math.max(0,-d))/p;o[i]=al===0?100:100-100/(1+ag/al);}return o;}
function pivotsAt(d,end,depth=2){let highs=[],lows=[];for(let i=Math.max(depth,end-180);i<=end-depth;i++){let h=true,l=true;for(let j=1;j<=depth;j++){if(d[i].high<=d[i-j].high||d[i].high<d[i+j].high)h=false;if(d[i].low>=d[i-j].low||d[i].low>d[i+j].low)l=false;}if(h)highs.push({i,price:d[i].high});if(l)lows.push({i,price:d[i].low});}return{highs,lows};}
function lastPivot(a){return a.length?a[a.length-1]:null;}
// Liquidez real: requiere dos pivotes similares y un nivel que siga sin barrer.
function activeLiquidityPools(d,end,pivots){
 const ranges=[];for(let k=Math.max(1,end-39);k<=end;k++)ranges.push(d[k].high-d[k].low);ranges.sort((a,b)=>a-b);
 const medianRange=ranges.length?ranges[Math.floor(ranges.length/2)]:0,tolerance=Math.max(medianRange*.18,Math.abs(d[end]?.close||0)*1e-7,1e-8);
 const find=(items,side)=>{const candidates=[],used=new Set();for(const base of items){const cluster=items.filter(p=>Math.abs(p.price-base.price)<=tolerance);if(cluster.length<2)continue;
  const key=cluster.map(p=>p.i).sort((a,b)=>a-b).join(",");if(used.has(key))continue;used.add(key);
  const latest=cluster.reduce((a,b)=>a.i>b.i?a:b),level=cluster.reduce((sum,p)=>sum+p.price,0)/cluster.length;let swept=false;
  for(let k=latest.i+1;k<=end;k++){if(side==="BSL"?d[k].high>level+tolerance:d[k].low<level-tolerance){swept=true;break;}}
  if(swept||(side==="BSL"?level<=d[end].close:level>=d[end].close))continue;
  candidates.push({price:level,i:latest.i,count:cluster.length,side});}
  candidates.sort((a,b)=>side==="BSL"?a.price-b.price:b.price-a.price);return candidates;};
 const bslLevels=find(pivots.highs,"BSL"),sslLevels=find(pivots.lows,"SSL");
 return{bsl:bslLevels[0]||null,ssl:sslLevels[0]||null,bslLevels,sslLevels};
}
function reject(c,buy){let body=Math.abs(c.close-c.open),lw=Math.min(c.open,c.close)-c.low,uw=c.high-Math.max(c.open,c.close);return buy?c.close>c.open&&lw>=Math.max(body*.35,(c.high-c.low)*.2):c.close<c.open&&uw>=Math.max(body*.35,(c.high-c.low)*.2);}
function getZones(d,i){let ob=[],fvg=[];for(let k=Math.max(2,i-35);k<=i;k++){let c=d[k],future=d.slice(k+1,Math.min(i+1,k+5));if(k<i&&c.close<c.open&&future.some(x=>x.close>c.high))ob.push({side:"BUY",low:c.low,high:Math.max(c.open,c.close),i:k});if(k<i&&c.close>c.open&&future.some(x=>x.close<c.low))ob.push({side:"SELL",low:Math.min(c.open,c.close),high:c.high,i:k});if(d[k].low>d[k-2].high)fvg.push({side:"BUY",low:d[k-2].high,high:d[k].low,i:k});if(d[k].high<d[k-2].low)fvg.push({side:"SELL",low:d[k].high,high:d[k-2].low,i:k});}return{ob,fvg};}
function makeIndicators(d){let close=d.map(x=>x.close);return{e9:emaSeries(close,9),e20:emaSeries(close,20),e50:emaSeries(close,50),rsi:rsiSeries(close,14)};}
let obAnalysisSeconds=300,liquidityAnalysisSeconds=300;
function aggregateCandlesM1(d,end,seconds){const out=[],map=[];for(let i=0;i<=end;i++){const c=d[i],bucket=Math.floor(c.time/seconds)*seconds,last=out[out.length-1];if(last&&last.time===bucket){last.high=Math.max(last.high,c.high);last.low=Math.min(last.low,c.low);last.close=c.close;map[map.length-1]=i;}else{out.push({time:bucket,open:c.open,high:c.high,low:c.low,close:c.close});map.push(i);}}return{candles:out,lastIndex:out.length-1,map};}
function readMultiTfSettings(){const ob=document.getElementById("ob-timeframe"),liq=document.getElementById("liquidity-timeframe");if(ob)obAnalysisSeconds=Number(ob.value)||300;if(liq)liquidityAnalysisSeconds=Number(liq.value)||300;try{localStorage.setItem("botder-ob-tf",String(obAnalysisSeconds));localStorage.setItem("botder-liq-tf",String(liquidityAnalysisSeconds));}catch(e){}if(typeof selectedMarket!=="undefined"&&selectedMarket&&Array.isArray(m1Candles)&&m1Candles.length)analyzeCandles(selectedMarket.symbol,selectedMarket.name,m1Candles);}
document.addEventListener("DOMContentLoaded",()=>{try{obAnalysisSeconds=Number(localStorage.getItem("botder-ob-tf"))||300;liquidityAnalysisSeconds=Number(localStorage.getItem("botder-liq-tf"))||300;}catch(e){}const ob=document.getElementById("ob-timeframe"),liq=document.getElementById("liquidity-timeframe");if(ob){ob.value=String(obAnalysisSeconds);ob.addEventListener("change",readMultiTfSettings);}if(liq){liq.value=String(liquidityAnalysisSeconds);liq.addEventListener("change",readMultiTfSettings);}});
function obNearEma9(d,i,x,ob){if(!ob||!d[i]||!Number.isFinite(x.e9[i]))return false;const lo=Math.min(ob.low,ob.high),hi=Math.max(ob.low,ob.high),e=x.e9[i],dist=e<lo?lo-e:e>hi?e-hi:0;let sum=0,n=0;for(let k=Math.max(1,i-13);k<=i;k++){const c=d[k],p=d[k-1],tr=Math.max(c.high-c.low,Math.abs(c.high-p.close),Math.abs(c.low-p.close));if(Number.isFinite(tr)){sum+=tr;n++;}}const atr=n?sum/n:Math.max(d[i].high-d[i].low,1e-8);return dist<=atr*1.5;}
function structureAt(d,i,x){
 const c=d[i],prev=d[i-1];if(!c||!prev||x.rsi[i]==null)return{annotations:[],signal:null,projection:null};
 const od=aggregateCandlesM1(d,i,obAnalysisSeconds),ld=aggregateCandlesM1(d,i-1,liquidityAnalysisSeconds),oi=od.lastIndex,li=ld.lastIndex;
 const op=pivotsAt(od.candles,oi-2),lp=pivotsAt(ld.candles,li-2),z=getZones(od.candles,oi),pools=activeLiquidityPools(ld.candles,li-2,lp),piv=pivotsAt(d,i-2),ann=[];z.ob=z.ob.filter(v=>obNearEma9(d,i,x,v));
 const mark=(type,price,label,side,time=c.time)=>{if(Number.isFinite(price))ann.push({type,price,label,side,time});};
 piv.highs.slice(-8).forEach(p=>mark("pivot",p.price,"PIVOTE ALTO","",d[p.i].time));piv.lows.slice(-8).forEach(p=>mark("pivot",p.price,"PIVOTE BAJO","",d[p.i].time));
 op.highs.slice(-6).forEach(p=>mark("pivot",p.price,"PIVOTE OB ALTO","",d[od.map[p.i]]?.time??c.time));op.lows.slice(-6).forEach(p=>mark("pivot",p.price,"PIVOTE OB BAJO","",d[od.map[p.i]]?.time??c.time));
 pools.bslLevels.forEach((p,n)=>mark("liquidity",p.price,"LIQUIDEZ BSL "+(n+1),"",d[ld.map[p.i]]?.time??c.time));pools.sslLevels.forEach((p,n)=>mark("liquidity",p.price,"LIQUIDEZ SSL "+(n+1),"",d[ld.map[p.i]]?.time??c.time));
 ["BUY","SELL"].forEach(side=>{const v=z.ob.filter(v=>v.side===side).at(-1);if(v){const time=d[od.map[v.i]]?.time??c.time;mark("ob",v.low,"OB "+side,v.side,time);mark("ob",v.high,"",v.side,time);}});
 const crossBuy=x.e9[i]>x.e20[i]&&x.e9[i-1]<=x.e20[i-1],crossSell=x.e9[i]<x.e20[i]&&x.e9[i-1]>=x.e20[i-1];
 const obBuy=z.ob.filter(v=>v.side==="BUY"&&c.low<=v.high&&c.close>=v.low).at(-1),obSell=z.ob.filter(v=>v.side==="SELL"&&c.high>=v.low&&c.close<=v.high).at(-1),buy=!!obBuy&&crossBuy,sell=!!obSell&&crossSell;let signal=null;
 if(buy||sell){const isBuy=buy,direction=isBuy?"COMPRAR":"VENDER",entry=c.close,targets=(isBuy?pools.bslLevels:pools.sslLevels).filter(p=>isBuy?p.price>entry:p.price<entry).sort((a,b)=>isBuy?a.price-b.price:b.price-a.price),stop=(isBuy?pools.sslLevels:pools.bslLevels).filter(p=>isBuy?p.price<entry:p.price>entry).sort((a,b)=>isBuy?b.price-a.price:a.price-b.price)[0],sl=stop?.price,tp1=targets[0]?.price,tp2=targets[1]?.price;
 if(Number.isFinite(sl)&&Number.isFinite(tp1)&&Number.isFinite(tp2)&&((isBuy&&sl<entry&&tp1>entry&&tp2>tp1)||(!isBuy&&sl>entry&&tp1<entry&&tp2<tp1)))signal={direction,entry,sl,tp1,tp2,rsi:x.rsi[i],time:c.time,index:i,mode:"OB M"+(obAnalysisSeconds/60)+" + EMA 9/20 M1 · liquidez M"+(liquidityAnalysisSeconds/60),emaPeriods:[9,20]};}
 let projection=null,bias=crossBuy?"BUY":crossSell?"SELL":x.e9[i]>x.e20[i]?"BUY":x.e9[i]<x.e20[i]?"SELL":null;
 if(bias){const isBuy=bias,ob=(isBuy?z.ob.filter(v=>v.side==="BUY"):z.ob.filter(v=>v.side==="SELL")).at(-1),targets=(isBuy?pools.bslLevels:pools.sslLevels).filter(p=>isBuy?p.price>c.close:p.price<c.close).sort((a,b)=>isBuy?a.price-b.price:b.price-a.price),stop=(isBuy?pools.sslLevels:pools.bslLevels).filter(p=>isBuy?p.price<c.close:p.price>c.close).sort((a,b)=>isBuy?b.price-a.price:a.price-b.price)[0];if(ob&&stop&&targets.length>=2){const low=Math.min(ob.low,ob.high),high=Math.max(ob.low,ob.high);projection={direction:isBuy?"COMPRAR":"VENDER",low,high,entry:isBuy?high:low,sl:stop.price,tp1:targets[0].price,tp2:targets[1].price,stage:c.close>=low&&c.close<=high?"PRECIO EN ZONA":"EN PREPARACIÓN",reason:"OB M"+(obAnalysisSeconds/60)+" · liquidez M"+(liquidityAnalysisSeconds/60)+" · entrada M1"};}}
 if(signal){mark("signal",signal.entry,signal.direction,signal.direction==="COMPRAR"?"BUY":"SELL");projection={...signal,low:signal.entry,high:signal.entry,stage:"SEÑAL CONFIRMADA"};}
 return{annotations:ann,signal,projection};
}
function buildZoneOutlook(d,i,x){
 if(!d[i])return{buy:null,sell:null};const od=aggregateCandlesM1(d,i-1,obAnalysisSeconds),ld=aggregateCandlesM1(d,i-1,liquidityAnalysisSeconds),oi=od.lastIndex,li=ld.lastIndex,p=pivotsAt(ld.candles,li-2),pools=activeLiquidityPools(ld.candles,li-2,p),z=getZones(od.candles,oi);z.ob=z.ob.filter(v=>obNearEma9(d,i,x,v));
 const make=side=>{const ob=z.ob.filter(v=>v.side===side).at(-1);if(!ob)return null;const low=Math.min(ob.low,ob.high),high=Math.max(ob.low,ob.high),buy=side==="BUY",entry=buy?high:low,targets=(buy?pools.bslLevels:pools.sslLevels).filter(p=>buy?p.price>entry:p.price<entry).sort((a,b)=>buy?a.price-b.price:b.price-a.price),stop=(buy?pools.sslLevels:pools.bslLevels).filter(p=>buy?p.price<entry:p.price>entry).sort((a,b)=>buy?b.price-a.price:a.price-b.price)[0];if(!stop||targets.length<2)return null;return{direction:buy?"COMPRAR":"VENDER",low,high,entry,sl:stop.price,tp1:targets[0].price,tp2:targets[1].price,source:(buy?"OB ALCISTA":"OB BAJISTA")+" M"+(obAnalysisSeconds/60),reason:"OB M"+(obAnalysisSeconds/60)+" · liquidez M"+(liquidityAnalysisSeconds/60)+" · gráfico M1"};};return{buy:make("BUY"),sell:make("SELL")};
}
function renderProjectionCard(zones){
 const a=document.getElementById("projection-card"),s=document.getElementById("projection-status");if(!a)return;
 const list=[zones?.buy,zones?.sell].filter(Boolean);
 if(!list.length){a.className="empty-state";a.textContent="Esperando un OB válido en M1.";if(s)s.textContent="ANALIZANDO";return;}
 a.className="zone-outlook-list";
 a.innerHTML=list.map(p=>{const buy=p.direction==="COMPRAR";return '<article class="projection-card '+(buy?"projection-buy":"projection-sell")+'"><div class="projection-stage '+(buy?"buy":"sell")+'">'+(buy?"OB ALCISTA · COMPRA":"OB BAJISTA · VENTA")+'</div><div class="projection-meta"><b>ENTRADA OB:</b> '+fmt(p.entry)+'<br><b>SL LIQUIDEZ ESTRUCTURAL:</b> '+fmt(p.sl)+'<br><b>TP1 LIQUIDEZ:</b> '+fmt(p.tp1)+'<br><b>TP2 LIQUIDEZ:</b> '+fmt(p.tp2)+'<br><span class="zone-source">'+p.source+' · '+fmt(p.low)+' — '+fmt(p.high)+'</span><br>'+p.reason+'<br><b>ESPERAR CRUCE EMA 9/20</b></div></article>';}).join("");
 if(s)s.textContent="OB M1 · ENTRADA / SL / TP";
}
function computeTrade(d,s,i){let t={...s,entryTime:d[i].time*1000,tp1Hit:false};for(let j=i+1;j<d.length;j++){let c=d[j],stop=s.direction==="COMPRAR"?c.low<=s.sl:c.high>=s.sl,one=s.direction==="COMPRAR"?c.high>=s.tp1:c.low<=s.tp1,two=s.direction==="COMPRAR"?c.high>=s.tp2:c.low<=s.tp2;if(stop){t.result="PERDIDA";t.price=s.sl;t.exitTime=c.time*1000;return t;}if(one)t.tp1Hit=true;if(two){t.result="GANADA";t.price=s.tp2;t.exitTime=c.time*1000;return t;}}t.result="ABIERTA";return t;}
function setBacktestTrades(trades){backtestTradeData=Array.isArray(trades)?trades.slice():[];const manual=(strategyJournal||[]).map(t=>({...t,tp1:t.tp,tp2:t.tp,price:t.exitPrice,exitTime:t.exitTime||Date.now()}));if(typeof setChartBacktestTrades==="function")setChartBacktestTrades([...backtestTradeData,...manual]);if(typeof drawMarketChart==="function")drawMarketChart();renderStrategyJournal();}
function runStructuralBacktest(symbol,market,candles,displayTf){
 if(!Array.isArray(candles)||candles.length<180)return[];
 const d=candles.slice().sort((x,y)=>x.time-y.time),from=Math.max(150,d.length-2880),trades=[];let nextFree=from;
 const stride=1;
 for(let i=from;i<d.length-4;i+=stride){
  if(i<nextFree)continue;
  const prefix=d.slice(Math.max(0,i-499),i+1),cutoff=prefix.at(-1).time;
  const before=seconds=>((higherTfBuffers&&higherTfBuffers[seconds])||[]).filter(v=>v.time<=cutoff);
  const h4=before(14400).length?before(14400):candlesAtTf(prefix,14400),m30=before(1800).length?before(1800):candlesAtTf(prefix,1800),h1=before(3600).length?before(3600):candlesAtTf(prefix,3600),d1=before(86400);
  const target=candlesAtTf(prefix,600);
  const plan=buildStructuralPlan(prefix,displayTf,{h4,m30,h1,d1,target});
  if(!plan.signal)continue;
  const s=plan.signal,cand=plan.candidate,structureKey=cand?[displayTf,cand.side,cand.line1.time1,cand.line1.time2,Number(cand.line1.price1).toPrecision(12),Number(cand.line1.price2).toPrecision(12)].join(":"):"";if(structureKey&&trades.some(t=>t.structureKey===structureKey))continue;let result="ABIERTA",price=s.entry,exitTime=null,exitIndex=-1;
  for(let j=i+1;j<d.length;j++){
   const bar=d[j],stop=s.direction==="COMPRAR"?bar.low<=s.sl:bar.high>=s.sl,first=s.direction==="COMPRAR"?bar.high>=s.tp1:bar.low<=s.tp1,second=s.direction==="COMPRAR"?bar.high>=s.tp2:bar.low<=s.tp2;
   if(stop){result="PERDIDA";price=s.sl;exitTime=bar.time*1000;exitIndex=j;break;}
   if(second){result="GANADA";price=s.tp2;exitTime=bar.time*1000;exitIndex=j;break;}
   if(first){result="GANADA";price=s.tp1;exitTime=bar.time*1000;exitIndex=j;break;}
  }
  trades.push({id:"BT-"+symbol+"-"+s.time,symbol,market,direction:s.direction,entry:s.entry,sl:s.sl,tp1:s.tp1,tp2:s.tp2,price,entryTime:s.time*1000,exitTime,result,timeframe:s.timeframe,structureKey,structureLines:(plan.lines||[]).map(line=>({...line,touches:(line.touches||[]).map(t=>({...t}))})),exitReason:result==="GANADA"?(price===s.tp2?"TP2":"TP1"):"SL"});
  nextFree=exitIndex>i?exitIndex:i+1;
 }
 backtestTrades.splice(0,backtestTrades.length,...trades);setBacktestTrades(trades);backtestSymbol=symbol;backtestReady=true;
 const closed=trades.filter(t=>t.result==="GANADA"||t.result==="PERDIDA"),wins=closed.filter(t=>t.result==="GANADA").length;
 setText("chart-message","BACKTEST NUEVA ESTRATEGIA · "+trades.length+" operaciones · "+wins+" ganadas · "+(closed.length-wins)+" pérdidas · TP1 línea opuesta · TP2 estructura M10 · SL estructural.");
 return trades;
}
function runBacktest(symbol,market,candles){if(!Array.isArray(candles)||candles.length<100){setText("chart-message","Esperando al menos 100 velas M1 para el backtesting.");return;}let d=candles.slice().sort((a,b)=>a.time-b.time),x=makeIndicators(d),trades=[],annotations=[],nextFree=-1;for(let i=65;i<d.length-1;i++){let r=structureAt(d,i,x);annotations.push(...r.annotations);if(r.signal){annotations.push({type:"signal",price:r.signal.entry,label:r.signal.direction,side:r.signal.direction,time:d[i].time});if(i>nextFree){let t=computeTrade(d,r.signal,i);trades.push({...t,symbol,market});nextFree=t.exitTime?Math.max(i,d.findIndex(v=>v.time*1000===t.exitTime)):i;}}}backtestTrades.splice(0,backtestTrades.length,...trades);setBacktestTrades(trades);backtestSymbol=symbol;backtestReady=true;updateDailyPanel();drawRsiPanel(x.rsi,d);let closed=trades.filter(t=>t.result==="GANADA"||t.result==="PERDIDA"),wins=closed.filter(t=>t.result==="GANADA").length;setText("chart-message","Historial M1 actualizado · señales actuales según estructura H1/H4 + confirmación de 3 OB M1.");}
function notifyBot(title,body){if("Notification" in window&&Notification.permission==="granted")new Notification(title,{body});}
function activateAlerts(){if(!("Notification" in window)){setText("alert-status","Este navegador no admite notificaciones.");return;}Notification.requestPermission().then(p=>setText("alert-status",p==="granted"?"ALERTAS ACTIVADAS":"PERMISO NO CONCEDIDO"));}
function drawRsiPanel(series){let host=document.getElementById("rsi-area");if(!host)return;host.innerHTML="";let cv=document.createElement("canvas");cv.style.cssText="width:100%;height:100%;display:block";host.appendChild(cv);let dpr=Math.min(devicePixelRatio||1,2),w=host.clientWidth,h=host.clientHeight;cv.width=w*dpr;cv.height=h*dpr;let x=cv.getContext("2d");x.scale(dpr,dpr);for(let level of [40,50,60]){let y=10+(100-level)/100*(h-28);x.strokeStyle=level===50?"#8495aa":"#43546b";x.setLineDash([4,3]);x.beginPath();x.moveTo(24,y);x.lineTo(w-8,y);x.stroke();x.setLineDash([]);x.fillStyle="#a8b5c6";x.font="9px Arial";x.fillText(String(level),2,y+3);}x.beginPath();let st=Math.max(0,series.length-200),beg=false;for(let i=st;i<series.length;i++){if(series[i]==null)continue;let px=24+(i-st)/Math.max(1,series.length-st-1)*(w-32),py=10+(100-series[i])/100*(h-28);if(!beg){x.moveTo(px,py);beg=true;}else x.lineTo(px,py);}x.strokeStyle="#48a8ff";x.lineWidth=1.7;x.stroke();setText("rsi-current","RSI: "+(series.at(-1)==null?"--":series.at(-1).toFixed(1)));}
function optimizeBacktest(){setText("optimizer-result","Validación pendiente: no se optimizan parámetros para forzar un porcentaje de acierto.");}
function setAnalysisGranularity(){analysisGranularity=60;}
function setBacktestHistory(symbol,market,candles){if(!candles?.length)return;m1Candles=candles.slice();}
function updateBacktestTick(epoch,price){if(!Number.isFinite(epoch)||!Number.isFinite(price)||!m1Candles.length)return;let bucket=Math.floor(epoch/60)*60,last=m1Candles.at(-1);if(last&&last.time===bucket)m1Candles[m1Candles.length-1]={...last,high:Math.max(last.high,price),low:Math.min(last.low,price),close:price};else if(!last||bucket>last.time){m1Candles.push({time:bucket,open:price,high:price,low:price,close:price});}}
document.addEventListener("DOMContentLoaded",()=>{if(typeof createMarketChart==="function")createMarketChart();updateDailyPanel();setInterval(updateDailyPanel,1000);});

// EMA display switches redraw immediately; calculations and signals remain active.
document.addEventListener("DOMContentLoaded",()=>{[9,20,50].forEach(period=>{const el=document.getElementById("show-ema"+period);if(el)el.addEventListener("change",()=>{if(typeof drawMarketChart==="function")drawMarketChart();});});});

/* MULTI-TIMEFRAME STRUCTURE ENGINE */
function candlesAtTf(source,seconds){const out=[];for(const c of source){const time=Math.floor(c.time/seconds)*seconds,last=out[out.length-1];if(last&&last.time===time){last.high=Math.max(last.high,c.high);last.low=Math.min(last.low,c.low);last.close=c.close;}else out.push({time,open:c.open,high:c.high,low:c.low,close:c.close});}return out;}
// ZigZag 5/3/3: profundidad 5, desviación adaptativa equivalente a 3 fracciones del rango medio y backstep 3.
function structurePivots(d,depth=3,deviation=3,backstep=3){
 const candidates=[];if(!Array.isArray(d)||d.length<depth*2+3)return{highs:[],lows:[],zigzag:[],settings:{depth,deviation,backstep}};
 const ranges=d.slice(-Math.min(20,d.length)).map(c=>Math.max(0,c.high-c.low)).sort((a,b)=>a-b),median=ranges[Math.floor(ranges.length/2)]||0,minMove=Math.max(median*(deviation/10),Math.abs(d.at(-1)?.close||0)*1e-8,1e-10);
 for(let i=depth;i<d.length-depth;i++){let hi=true,lo=true;for(let k=1;k<=depth;k++){if(d[i].high<=d[i-k].high||d[i].high<d[i+k].high)hi=false;if(d[i].low>=d[i-k].low||d[i].low>d[i+k].low)lo=false;}if(hi)candidates.push({i,time:d[i].time,price:d[i].high,type:"high",confirmedAt:i+depth});if(lo)candidates.push({i,time:d[i].time,price:d[i].low,type:"low",confirmedAt:i+depth});}
 candidates.sort((a,b)=>a.i-b.i||(a.type==="high"?-1:1));const stable=[];
 for(const p of candidates){const last=stable.at(-1);if(last&&last.type===p.type&&p.i-last.i<=backstep)continue;const opposite=[...stable].reverse().find(q=>q.type!==p.type);if(opposite&&Math.abs(p.price-opposite.price)<minMove)continue;stable.push(p);}
 return{highs:stable.filter(p=>p.type==="high"),lows:stable.filter(p=>p.type==="low"),zigzag:stable,settings:{depth,deviation,backstep,minMove,confirmedRightBars:depth}};
}
function findDiagonalStructure(source,seconds,tf){
 if(!Array.isArray(source)||source.length<22)return null;
 const d=source.slice(-500),p=structurePivots(d,5,3,3);
 const ranges=d.slice(-50).map(c=>c.high-c.low).sort((a,b)=>a-b);
 const median=ranges[Math.floor(ranges.length/2)]||Math.abs(d.at(-1).close)*.0001;
 const tol=Math.max(median*.22,Math.abs(d.at(-1).close)*.000005);
 const find=(side,points,sign)=>{
  let best=null;const pts=points.slice(-36);
  for(let ai=0;ai<pts.length-2;ai++)for(let bi=ai+1;bi<pts.length-1;bi++){
   const p1=pts[ai],p2=pts[bi],dx=p2.i-p1.i;
   if(dx<6)continue;
   const slope=(p2.price-p1.price)/dx;
   if(Math.sign(slope)!==sign||Math.abs(p2.price-p1.price)<median*.35)continue;
   const aligned=pts.filter(q=>Math.abs(q.price-(p1.price+slope*(q.i-p1.i)))<=tol).sort((a,b)=>a.i-b.i);
   const touches=[];
   for(const q of aligned){const prev=touches.at(-1);if(!prev||q.i-prev.i>=5)touches.push(q);else if(Math.abs(q.price-(p1.price+slope*(q.i-p1.i)))<Math.abs(prev.price-(p1.price+slope*(prev.i-p1.i))))touches[touches.length-1]=q;}
   if(touches.length<2)continue;
   const sequence=touches.slice(-3),first=sequence[0],last=sequence.at(-1),previous=sequence.at(-2),gap=Math.max(5,Math.min(40,last.i-previous.i));
   // Una línea estructural queda invalidada si una vela cierra/penetra más allá del margen; no se cuentan contactos posteriores a la ruptura.
   let broken=false;
   for(let k=p1.i+1;k<d.length;k++){
    const level=p1.price+slope*(k-p1.i),c=d[k];
    if(side==="BUY"?c.close<level-tol*1.25:c.close>level+tol*1.25){broken=true;break;}
   }
   if(broken)continue;
   // Los tres toques deben pertenecer a una misma secuencia reciente, no a máximos/minimos aislados de sesiones distintas.
   if(d.length-1-last.i>Math.max(45,gap*3))continue;
   const score=300-(d.length-1-last.i)*2-(last.i-first.i)*.02;
   if(!best||score>best.score)best={side,p1,p2,slope,touches:sequence,score,gap,third:sequence.length===3?last:null};
  }
  return best;
 };
 // COMPRA: la línea estructural es el soporte ascendente (mínimos). VENTA: la resistencia descendente (máximos).
 const buy=find("BUY",p.lows,1),sell=find("SELL",p.highs,-1),v=[buy,sell].filter(Boolean).sort((a,b)=>b.score-a.score)[0];
 if(!v)return null;
 const baseAt=i=>v.p1.price+v.slope*(i-v.p1.i);
 const opposite=v.side==="BUY"?p.highs:p.lows;
 const offsets=opposite.map(q=>q.price-baseAt(q.i)).filter(x=>v.side==="BUY"?x>tol:x< -tol);
 if(!offsets.length)return null;
 offsets.sort((a,b)=>a-b);const offset=offsets[Math.floor(offsets.length/2)];
 const oppositeTouches=[];
 for(const q of opposite.slice(-40)){
  const dist=Math.abs(q.price-(baseAt(q.i)+offset));
  if(dist<=tol*1.6&&(!oppositeTouches.length||q.i-oppositeTouches.at(-1).i>=5))oppositeTouches.push(q);
 }
 const upperSequence=oppositeTouches.slice(-3);
 const firstCandle=d[v.touches[0].i],last=v.touches.at(-1),projectedIndex=last.i+v.gap;
 const line1={time1:d[v.p1.i].time,time2:d[v.p2.i].time,price1:v.p1.price,price2:v.p2.price,touches:v.touches.map((t,i)=>({time:d[t.i].time,price:t.price,n:i+1}))};
 const line2={time1:d[v.p1.i].time,time2:d[v.p2.i].time,price1:v.p1.price+offset,price2:v.p2.price+offset,touches:upperSequence.map((t,i)=>({time:d[t.i].time,price:t.price,n:i+1}))};
 return{side:v.side,tf,seconds,d,first:v.touches[0],second:v.touches[1],third:v.third,firstStop:v.touches[0].price,touches:v.touches.map((t,i)=>({...t,n:i+1,time:d[t.i].time})),line1,line2,projectTime:d.at(-1).time+(projectedIndex-(d.length-1))*seconds,projectPrice1:baseAt(projectedIndex),projectPrice2:baseAt(projectedIndex)+offset,tolerance:tol,expectedIndex:projectedIndex,gap:v.gap,zigzagSettings:"5/3/3"};
}
function depthSafe(v){return v;}
function backstepSafe(v){return v;}
function detectOrderBlocks(source,side){const found=[];for(let i=Math.max(1,source.length-180);i<source.length-1;i++){const c=source[i],next=source.slice(i+1,Math.min(source.length,i+5));if(side==="BUY"&&c.close<c.open&&next.some(n=>n.close>c.high)&&next.some(n=>n.close>n.open))found.push({side,low:c.low,high:Math.max(c.open,c.close),time:c.time});if(side==="SELL"&&c.close>c.open&&next.some(n=>n.close<c.low)&&next.some(n=>n.close<n.open))found.push({side,low:Math.min(c.open,c.close),high:c.high,time:c.time});}return found.filter((z,i,a)=>a.findIndex(v=>v.time===z.time)===i);}
function latestObBias(source){const all=[...detectOrderBlocks(source,"BUY"),...detectOrderBlocks(source,"SELL")].sort((a,b)=>a.time-b.time);return all.length?all.at(-1).side:null;}
function buildStructuralPlan(m1,displayTf,historyContext=null){
 const cutoff=Number(m1.at(-1)?.time)||Infinity;
 const closedHistory=(rows,seconds)=>(Array.isArray(rows)?rows:[]).filter(c=>Number(c.time)+seconds<=cutoff+60),aggregateClosed=seconds=>candlesAtTf(m1,seconds).filter(c=>Number(c.time)+seconds<=cutoff+60);
 const rawH4=historyContext?.h4||getHigherTimeframeHistory(14400)||[],rawM30=historyContext?.m30||getHigherTimeframeHistory(1800)||[];
 const h4Closed=closedHistory(rawH4,14400),m30Closed=closedHistory(rawM30,1800);
 const h4=h4Closed.length>=22?h4Closed:rawH4,m30=m30Closed.length>=22?m30Closed:rawM30;
 const d1=historyContext?.d1||getHigherTimeframeHistory(86400)||[],biasD1=latestObBias(d1),bias4=latestObBias(h4),bias30=latestObBias(m30);
 const lines=[],items=[],activeTf=Number(displayTf)||60;
 // Cada gráfico usa su propio historial cerrado; los TF menores se agregan desde M1.
 const h1Raw=historyContext?.h1||getHigherTimeframeHistory(3600)||[],h1Closed=closedHistory(h1Raw,3600);
 const m30Source=m30Closed.length>=22?m30Closed:aggregateClosed(1800);
 const activeSource=activeTf===14400?h4:activeTf===3600?(h1Closed.length>=22?h1Closed:aggregateClosed(3600)):activeTf===1800?m30Source:aggregateClosed(activeTf);
 const tfLabel=activeTf>=3600?"H"+activeTf/3600:"M"+activeTf/60;
 const candidate=findDiagonalStructure(activeSource,activeTf,tfLabel);
 const push=s=>{if(!s)return;for(const [n,l] of [s.line1,s.line2].entries())lines.push({...l,side:s.side,primary:n===0,label:n===0?s.tf+" · "+(s.side==="BUY"?"SOPORTE / COMPRA":"RESISTENCIA / VENTA"):"",touches:(l.touches||[]).map(t=>n===0?{...t}:{time:t.time,price:t.price}),projectPrice1:n===0?s.projectPrice1:s.projectPrice2,projectPrice2:n===0?s.projectPrice1:s.projectPrice2,projectTime:s.projectTime});};
 push(candidate);
 const dir=candidate?.side,last=m1.at(-1),targetSeconds=600,targetTf="M10";
 const rawTarget=historyContext?.target||getHigherTimeframeHistory(600)||[],targetClosed=closedHistory(rawTarget,600),targetData=targetClosed.length>=12?targetClosed:aggregateClosed(600);
 const getTargets=(side,entry,minBeyond=entry)=>{if(!side||!Number.isFinite(entry)||!Number.isFinite(minBeyond))return[];const end=targetData.length-2;if(end<8)return[];const piv=pivotsAt(targetData,end,2),pools=activeLiquidityPools(targetData,end,piv);let levels=(side==="BUY"?pools.bslLevels:pools.sslLevels).map(v=>({price:v.price,time:targetData[v.i]?.time,kind:"LIQUIDEZ M10"}));if(levels.length<2){const swings=(side==="BUY"?piv.highs:piv.lows).map(v=>({price:v.price,time:targetData[v.i]?.time,kind:"PIVOTE M10"}));levels=[...levels,...swings.filter(v=>!levels.some(q=>Math.abs(q.price-v.price)<=Math.max(Math.abs(v.price)*1e-7,1e-9)))];}levels=levels.filter(v=>Number.isFinite(v.price)&&(side==="BUY"?v.price>minBeyond:v.price<minBeyond)).sort((x,y)=>side==="BUY"?x.price-y.price:y.price-x.price);const unique=[];for(const v of levels){if(unique.every(q=>Math.abs(q.price-v.price)>Math.max(Math.abs(v.price)*1e-7,1e-9)))unique.push(v);if(unique.length===1)break;}return unique;};
 // TP1 es la línea opuesta del canal; TP2 es la siguiente liquidez estructural de M10.
 const expectedPrice=candidate?candidate.line1.price1+(candidate.line1.price2-candidate.line1.price1)/Math.max(1,candidate.line1.time2-candidate.line1.time1)*(candidate.d.at(-1).time-candidate.line1.time1):NaN,zoneCenter=Number(expectedPrice),zoneLow=zoneCenter-(candidate?.tolerance||0),zoneHigh=zoneCenter+(candidate?.tolerance||0),oppositeSlope=candidate?(candidate.line2.price2-candidate.line2.price1)/Math.max(1,candidate.line2.time2-candidate.line2.time1):0,tp1Price=candidate?candidate.line2.price1+oppositeSlope*(candidate.d.at(-1).time-candidate.line2.time1):NaN,tp1=Number.isFinite(tp1Price)?{price:tp1Price,kind:"LÍNEA OPUESTA DEL CANAL"}:null,tp2=getTargets(dir,zoneCenter,tp1Price)[0],sl=candidate?.first.price??candidate?.firstStop;
 // La entrada se confirma con dos velas cerradas consecutivas: rechazo tocando la línea y vela siguiente a favor.
 const entryCandles=candidate?.d||[],entryEnd=entryCandles.length-1;
 const rejectionFor=(c,side)=>{if(!c)return false;const body=Math.abs(c.close-c.open),range=Math.max(1e-12,c.high-c.low),lower=Math.min(c.open,c.close)-c.low,upper=c.high-Math.max(c.open,c.close),doji=isDoji(c);return side==="BUY"?(doji||c.close<c.open)&&(doji?lower>=range*.18:lower>=Math.max(body*.2,range*.12)):(doji||c.close>c.open)&&(doji?upper>=range*.18:upper>=Math.max(body*.2,range*.12));};
 const rejectionCandle=entryCandles[entryEnd-1],confirmationCandle=entryCandles[entryEnd];
 const lineSlope=candidate?(candidate.line1.price2-candidate.line1.price1)/Math.max(1,candidate.line1.time2-candidate.line1.time1):0;
 const rejectionLinePrice=candidate?candidate.line1.price1+lineSlope*(rejectionCandle?.time-candidate.line1.time1):NaN;
 const touched=!!candidate&&!!rejectionCandle&&rejectionCandle.low<=rejectionLinePrice+candidate.tolerance&&rejectionCandle.high>=rejectionLinePrice-candidate.tolerance;
 const priorTouches=(candidate?.touches||[]).filter(t=>t.i<entryEnd-1).slice(-2);
 const enoughSeparation=priorTouches.length===2&&entryEnd-1-priorTouches[1].i>=5;
 const thirdTouch=!!candidate&&touched&&enoughSeparation?{...rejectionCandle,i:entryEnd-1,price:dir==="BUY"?rejectionCandle.low:rejectionCandle.high,time:rejectionCandle.time,n:3}:null;
 const rejection=thirdTouch&&rejectionFor(rejectionCandle,dir)?{...rejectionCandle,index:entryEnd-1}:null;
 const favorable=dir==="BUY"?confirmationCandle?.close>confirmationCandle?.open:confirmationCandle?.close<confirmationCandle?.open;
 const confirmation=rejection&&favorable?{...confirmationCandle,index:entryEnd}:null;
 const validLevels=!!candidate&&Number.isFinite(sl)&&!!tp1&&!!tp2&&(dir==="BUY"?sl<zoneCenter&&tp1.price>zoneCenter&&tp2.price>tp1.price:sl>zoneCenter&&tp1.price<zoneCenter&&tp2.price<tp1.price);
 const confirmed=!!thirdTouch&&!!rejection&&!!confirmation&&validLevels;
 if(thirdTouch&&lines[0])lines[0].touches=[...priorTouches.map((t,i)=>({time:candidate.d[t.i].time,price:t.price,n:i+1})),{time:thirdTouch.time,price:thirdTouch.price,n:3}];
 const h4Obs=[...detectOrderBlocks(h4,"BUY"),...detectOrderBlocks(h4,"SELL")].sort((x,y)=>x.time-y.time),m30Obs=[...detectOrderBlocks(m30,"BUY"),...detectOrderBlocks(m30,"SELL")].sort((x,y)=>x.time-y.time);
 const h4Latest=h4Obs.at(-1)||null,m30Latest=m30Obs.at(-1)||null;
 const h4Class=!bias4?"SIN SESGO CLARO":dir?(bias4===dir?"ZONA H4 A FAVOR":"ZONA H4 EN CONTRA"):"ZONA H4 "+(bias4==="BUY"?"COMPRA":"VENTA");
 const m30Class=m30Latest?(m30Latest.side===dir?"A FAVOR":"EN CONTRA"):"SIN OB";
 const addObPair=(o,label,active,tf)=>items.push({type:"ob",price:o.low,label,side:o.side,time:o.time,active:!!active,tf},{type:"ob",price:o.high,label:"",side:o.side,time:o.time,active:!!active,tf});
 // H4 y M30 son contexto visual; nunca bloquean una entrada de la estructura local.
 h4Obs.slice(-2).forEach(o=>addObPair(o,"ZONA H4 "+(o.side==="BUY"?"COMPRA":"VENTA"),o.side===bias4,14400));
 m30Obs.slice(-2).forEach(o=>addObPair(o,"OB M30",o.side===bias30,1800));
 const localObs=[...detectOrderBlocks(activeSource,"BUY"),...detectOrderBlocks(activeSource,"SELL")].sort((x,y)=>x.time-y.time);
 localObs.slice(-3).forEach(o=>addObPair(o,"OB "+tfLabel,o.side===dir,activeTf));
 const recommendation=!bias4?"H4 SIN SESGO CLARO":!dir?"H4 "+(bias4==="BUY"?"ZONA DE COMPRA":"ZONA DE VENTA"):bias4===dir?"H4 RECOMIENDA "+(dir==="BUY"?"COMPRA":"VENTA"):"H4 EN CONTRA · PRECAUCIÓN";
 const status=!candidate?"BUSCANDO ESTRUCTURA "+tfLabel:!thirdTouch?"ESPERANDO TERCER TOQUE EN LA LÍNEA":!validLevels?"TERCER TOQUE · ESPERANDO TP1/TP2 ESTRUCTURALES":!rejection?"TOQUE 3 · ESPERANDO DOJI O VELA DE RECHAZO":!confirmation?"RECHAZO DETECTADO · ESPERANDO VELA A FAVOR":dir==="BUY"?"COMPRA CONFIRMADA":"VENTA CONFIRMADA";
 let projection=null;
 if(candidate&&validLevels)projection={direction:dir==="BUY"?"COMPRAR":"VENDER",low:zoneLow,high:zoneHigh,zoneLow,zoneHigh,entry:confirmation?.close??zoneCenter,sl,tp1:tp1.price,tp2:tp2.price,targetTf,projectTime:confirmation?.time??candidate.projectTime,expiresAt:(confirmation?.time??candidate.projectTime)+candidate.seconds*5,stage:status,reason:"3 toques en la línea de entrada · vela de rechazo (doji o contraria) · vela siguiente a favor",timeframe:candidate.tf,confirmed,tp1Kind:tp1.kind,tp2Kind:tp2.kind,recommendation,h4Bias:bias4};
 const signal=confirmed?{direction:dir==="BUY"?"COMPRAR":"VENDER",entry:confirmation.close,sl,tp1:tp1.price,tp2:tp2.price,rsi:50,time:confirmation.time,index:m1.length-1,mode:"CANAL 3 TOQUES + RECHAZO + CONFIRMACIÓN",timeframe:candidate.tf,emaPeriods:[]}:null;
 return{lines,items,projection,status,confirmed,trend:bias4,bias4,bias30,biasD1,m30Class,h4Class,candidate,thirdTouch,near:localObs,last,signal,targetTf,confirmationTf:"INFORMATIVO",activeTf,recommendation,rejection,confirmation};
}
function renderProjection(plan){
 const el=document.getElementById("projection-card"),status=document.getElementById("projection-status");if(!el)return;
 if(!plan.projection){el.className="projection-empty";el.textContent=plan.status+" · Esperando una estructura válida.";if(status)status.textContent=plan.status;return;}
 const p=plan.projection,buy=p.direction==="COMPRAR",fmtPrice=v=>Number(v).toPrecision(8).replace(/0+$/,"").replace(/\.$/,"");
 el.className="projection-card"+(buy?"":" projection-sell");
 el.innerHTML='<div class="projection-stage '+(buy?"":"sell")+'">'+(buy?"COMPRA PROYECTADA":"VENTA PROYECTADA")+'</div><div class="projection-meta">'+p.stage+' · TERCER TOQUE '+p.timeframe+' · TP EN '+p.targetTf+'</div><div class="projection-levels"><div class="projection-level"><span>ENTRADA / ZONA</span><strong>'+fmtPrice(p.entry)+'</strong></div><div class="projection-level"><span>SL · TOQUE 1</span><strong>'+fmtPrice(p.sl)+'</strong></div><div class="projection-level"><span>TP1 · LÍNEA OPUESTA</span><strong>'+fmtPrice(p.tp1)+'</strong></div><div class="projection-level"><span>TP2 · ESTRUCTURA M10</span><strong>'+fmtPrice(p.tp2)+'</strong></div></div><div class="projection-meta">SL: invalidación estructural · TP1: toque de la línea opuesta · TP2: objetivo estructural calculado en M10.<br><b>CONTEXTO H4:</b> '+(p.recommendation||"SIN SESGO")+' (solo recomendación; no bloquea la señal).</div>';
 if(status)status.textContent=p.stage;
}
function analyzeCandles(symbol,market,candles){
 if(!Array.isArray(candles)||candles.length<100)return;
 const d=candles.slice().sort((x,y)=>x.time-y.time),i=d.length-2;if(i<65)return;
 const closed=d[i],tf=Number(document.getElementById("timeframe")?.value)||60,plan=buildStructuralPlan(d.slice(0,i+1),tf);
 evaluateOpenOperations(symbol,closed);evaluateStrategyJournal(symbol,closed);
 lastProjection=plan.projection;setText("side-analysis-status","● "+plan.status);
 setText("structure-diagnostic","ESTRUCTURA "+(plan.candidate?.tf||"BUSCANDO")+" · "+plan.status+" · "+plan.recommendation);
 const side=plan.bias4==="BUY"?"ZONA COMPRA":plan.bias4==="SELL"?"ZONA VENTA":"SIN ZONA H4",confirm=plan.recommendation||"INFORMATIVO";
 setText("trend-h4",side);setText("confirm-m30",confirm);setText("confirm-m1",plan.rejection?"RECHAZO DETECTADO":plan.thirdTouch?"ESPERANDO VELA DE RECHAZO":"ESPERANDO 3 TOQUES");
 setText("touch-status",plan.thirdTouch?"3º TOQUE":"BUSCANDO");setText("ob-status",plan.h4Class||"BUSCANDO");setText("channel-status",plan.candidate?(plan.candidate.side==="BUY"?"ALCISTA":"BAJISTA"):"BUSCANDO");
 renderProjection(plan);
 const btKey=symbol+":"+d[i].time+":"+tf;if(structuralBacktestKey!==btKey){structuralBacktestKey=btKey;runStructuralBacktest(symbol,market,d.slice(0,i+1),tf);}
 if(typeof setStructureOverlay==="function")setStructureOverlay({items:plan.items,lines:plan.lines,projection:plan.projection,activeTf:plan.activeTf});
 if(plan.projection&&typeof drawTradeLevels==="function")drawTradeLevels({entry:plan.projection.entry,sl:plan.projection.sl,tp1:plan.projection.tp1,tp2:plan.projection.tp2,time:closed.time,direction:plan.projection.direction},false);
 else if(typeof clearTradeLevels==="function")clearTradeLevels();
 if(plan.signal&&plan.candidate){const c=plan.candidate,structureKey=[tf,c.side,c.line1.time1,c.line1.time2,Number(c.line1.price1).toPrecision(12),Number(c.line1.price2).toPrecision(12)].join(":");const key=symbol+":"+structureKey;if(key!==lastSignalKey&&!usedStructureKeys.has(key)&&!strategyJournal.some(t=>t.structureKey===key)){lastSignalKey=key;addSignal({...plan.signal,symbol,market,candleTime:plan.signal.time,structureKey:key});recordStrategyTrade({...plan.signal,symbol,market,structureKey:key});notifyBot("BOTDER · "+plan.signal.direction,"Una señal: tercer toque válido de la estructura.");}}
 if(typeof drawRsiPanel==="function")drawRsiPanel(makeIndicators(d).rsi,d);
}
function analyzeLiveStructure(symbol,candles){
 if(!Array.isArray(candles)||candles.length<100||symbol!==selectedMarket?.symbol)return;
 const closed=candles.length>1?candles.slice(0,-1):candles,tf=Number(document.getElementById("timeframe")?.value)||60,plan=buildStructuralPlan(closed,tf);
 if(typeof setStructureOverlay==="function")setStructureOverlay({items:plan.items,lines:plan.lines,projection:plan.projection,activeTf:plan.activeTf});
}
/* Registro general de señales confirmadas: independiente de marcar ENTRÉ. */
let strategyJournal=[];
let structuralBacktestKey="";
function saveStrategyJournal(){try{localStorage.setItem("botder-structure-journal",JSON.stringify(strategyJournal.slice(0,2000)));}catch(e){}}
function loadStrategyJournal(){try{const v=JSON.parse(localStorage.getItem("botder-structure-journal")||"[]");if(Array.isArray(v))strategyJournal=v.slice(0,2000);}catch(e){strategyJournal=[];}renderStrategyJournal();}
function recordStrategyTrade(signal){
 if(!signal||strategyJournal.some(t=>t.symbol===signal.symbol&&(signal.structureKey?t.structureKey===signal.structureKey:t.entryTime===Number(signal.time)*1000&&t.direction===signal.direction)))return;
 strategyJournal.unshift({id:"STR-"+Date.now().toString(36).toUpperCase(),symbol:signal.symbol,market:signal.market,direction:signal.direction,entry:Number(signal.entry),sl:Number(signal.sl),tp1:Number(signal.tp1),tp2:Number(signal.tp2),tp:Number(signal.tp2),timeframe:signal.timeframe||"",structureKey:signal.structureKey||"",entryTime:Number(signal.time)*1000,result:"ABIERTA"});
 strategyJournal=strategyJournal.slice(0,2000);saveStrategyJournal();renderStrategyJournal();
}
function evaluateStrategyJournal(symbol,candle){
 if(!candle)return;let changed=false;
 strategyJournal.forEach(t=>{if(t.symbol!==symbol||t.result!=="ABIERTA"||candle.time*1000<=t.entryTime)return;
  const targetPrice=t.tp2||t.tp,stop=t.direction==="COMPRAR"?candle.low<=t.sl:candle.high>=t.sl,target=t.direction==="COMPRAR"?candle.high>=targetPrice:candle.low<=targetPrice;
  if(stop||target){t.result=stop?"PERDIDA":"GANADA";t.exitPrice=stop?t.sl:targetPrice;t.exitTime=candle.time*1000;t.exitReason=stop?"STOP LOSS":"TP2";changed=true;}
 });
 if(changed){saveStrategyJournal();renderStrategyJournal();}
}
function renderStrategyJournal(){
 const allResults=[...backtestTradeData,...strategyJournal],closed=allResults.filter(t=>t.result==="GANADA"||t.result==="PERDIDA"),wins=closed.filter(t=>t.result==="GANADA").length,losses=closed.length-wins;
 setText("bt-wins",wins);setText("bt-losses",losses);setText("bt-rate",closed.length?(wins/closed.length*100).toFixed(1)+"%":"0%");setText("bt-total",strategyJournal.length+backtestTradeData.length);setText("bt-open",allResults.filter(t=>t.result==="ABIERTA").length);
 const area=document.getElementById("history");if(!area)return;
 const safe=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 if(typeof setChartBacktestTrades==="function")setChartBacktestTrades([...backtestTradeData,...strategyJournal.map(t=>({...t,tp1:t.tp1||t.tp,tp2:t.tp2||t.tp,price:t.exitPrice,exitTime:t.exitTime||Date.now()}))]);area.innerHTML=strategyJournal.length?strategyJournal.map(t=>'<article class="history-row"><div><strong>'+safe(t.market||t.symbol)+' · '+safe(t.direction)+'</strong><small>'+new Date(t.entryTime).toLocaleString("es-PA",{dateStyle:"short",timeStyle:"short"})+' · ENTRADA '+fmt(t.entry)+' · SL '+fmt(t.sl)+' · TP1 '+fmt(t.tp1||t.tp)+' · TP2 '+fmt(t.tp2||t.tp)+'</small></div><span class="history-result '+t.result+'">'+(t.result==="ABIERTA"?"EN CURSO":t.result)+'</span></article>').join(""):'<div class="empty-state">Aún no hay entradas confirmadas. Aquí aparecerán las señales registradas y su resultado al alcanzar TP o SL.</div>';
}
loadStrategyJournal();
