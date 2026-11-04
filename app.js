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
function renderSignals(){const active=signals.filter(s=>s.status==="ACTIVE");setText("signal-count",active.length);const markup=active.length?active.map(s=>`<article class="signal-card"><div class="muted">${s.id} · ${s.market}</div><h3 class="${s.direction==="COMPRAR"?"buy":"sell"}">${s.direction}</h3><div class="levels"><div class="level"><span>ENTRADA</span><strong>${fmt(s.entry)}</strong></div><div class="level"><span>SL</span><strong>${fmt(s.sl)}</strong></div><div class="level"><span>TP1 ESTRUCTURAL</span><strong>${fmt(s.tp1)}</strong></div><div class="level"><span>TP2</span><strong>${fmt(s.tp2)}</strong></div></div><div class="muted">${s.mode||"RSI + EMA"} · RSI ${s.rsi.toFixed(1)} · EMA ${(s.emaPeriods||strategyConfig.emaPeriods).join("/")}</div><div class="action-row"><button class="enter-button" onclick="markEntered('${s.id}')">ENTRÉ</button><button class="ignore-button" onclick="markIgnored('${s.id}')">NO ENTRÉ</button></div></article>`).join(""):'<div class="empty-state">No hay señales activas.</div>';;["signals-top","signals-sidebar","signals"].forEach(id=>{const area=document.getElementById(id);if(area)area.innerHTML=markup;});}
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


const strategyConfig={emaPeriods:[9,20,50],rsiPeriod:14,adxPeriod:14,atrPeriod:14,bbPeriod:20,bbDeviation:2,adxMin:20,slBufferAtr:.12};

let analysisGranularity=60,lastProjection=null,lastProjectionNotice="";
function emaSeries(v,p){const o=Array(v.length).fill(null);if(v.length<p)return o;let e=v.slice(0,p).reduce((a,b)=>a+b,0)/p,k=2/(p+1);o[p-1]=e;for(let i=p;i<v.length;i++){e=v[i]*k+e*(1-k);o[i]=e;}return o;}
function rsiSeries(v,p=14){const o=Array(v.length).fill(null);if(v.length<=p)return o;let g=0,l=0;for(let i=1;i<=p;i++){let d=v[i]-v[i-1];g+=Math.max(0,d);l+=Math.max(0,-d);}let ag=g/p,al=l/p;o[p]=al===0?100:100-100/(1+ag/al);for(let i=p+1;i<v.length;i++){let d=v[i]-v[i-1];ag=(ag*(p-1)+Math.max(0,d))/p;al=(al*(p-1)+Math.max(0,-d))/p;o[i]=al===0?100:100-100/(1+ag/al);}return o;}
function atrSeries(d,p=14){const tr=d.map((c,i)=>i?Math.max(c.high-c.low,Math.abs(c.high-d[i-1].close),Math.abs(c.low-d[i-1].close)):c.high-c.low),o=Array(d.length).fill(null);if(d.length<=p)return o;let a=tr.slice(1,p+1).reduce((x,y)=>x+y,0)/p;o[p]=a;for(let i=p+1;i<d.length;i++){a=(a*(p-1)+tr[i])/p;o[i]=a;}return o;}
function adxSeries(d,p=14){const n=d.length,tr=Array(n).fill(0),up=Array(n).fill(0),dn=Array(n).fill(0);for(let i=1;i<n;i++){let u=d[i].high-d[i-1].high,v=d[i-1].low-d[i].low;up[i]=u>v&&u>0?u:0;dn[i]=v>u&&v>0?v:0;tr[i]=Math.max(d[i].high-d[i].low,Math.abs(d[i].high-d[i-1].close),Math.abs(d[i].low-d[i-1].close));}const sm=a=>{let o=Array(n).fill(null),v=a.slice(1,p+1).reduce((x,y)=>x+y,0);o[p]=v;for(let i=p+1;i<n;i++){v=v-v/p+a[i];o[i]=v;}return o;},t=sm(tr),u=sm(up),v=sm(dn),dx=Array(n).fill(null),pdi=Array(n).fill(null),mdi=Array(n).fill(null),adx=Array(n).fill(null);for(let i=p;i<n;i++)if(t[i]){pdi[i]=100*u[i]/t[i];mdi[i]=100*v[i]/t[i];dx[i]=100*Math.abs(pdi[i]-mdi[i])/Math.max(.00001,pdi[i]+mdi[i]);}let seed=dx.slice(p,2*p).filter(Number.isFinite);if(seed.length===p){adx[2*p-1]=seed.reduce((a,b)=>a+b,0)/p;for(let i=2*p;i<n;i++)adx[i]=(adx[i-1]*(p-1)+dx[i])/p;}return{adx,pdi,mdi};}
function bollingerSeries(v,p=20,m=2){let o=Array(v.length).fill(null);for(let i=p-1;i<v.length;i++){let a=v.slice(i-p+1,i+1),mid=a.reduce((x,y)=>x+y,0)/p,sd=Math.sqrt(a.reduce((x,y)=>x+(y-mid)**2,0)/p);o[i]={mid,upper:mid+m*sd,lower:mid-m*sd};}return o;}
function pivotsAt(d,end,depth=2){let highs=[],lows=[];for(let i=Math.max(depth,end-180);i<=end-depth;i++){let h=true,l=true;for(let j=1;j<=depth;j++){if(d[i].high<=d[i-j].high||d[i].high<d[i+j].high)h=false;if(d[i].low>=d[i-j].low||d[i].low>d[i+j].low)l=false;}if(h)highs.push({i,price:d[i].high});if(l)lows.push({i,price:d[i].low});}return{highs,lows};}
function lastPivot(a){return a.length?a[a.length-1]:null;}
function reject(c,buy){let body=Math.abs(c.close-c.open),lw=Math.min(c.open,c.close)-c.low,uw=c.high-Math.max(c.open,c.close);return buy?c.close>c.open&&lw>=Math.max(body*.35,(c.high-c.low)*.2):c.close<c.open&&uw>=Math.max(body*.35,(c.high-c.low)*.2);}
function getZones(d,i,atr){let ob=[],fvg=[];for(let k=Math.max(2,i-35);k<=i;k++){let c=d[k];if(k<i&&c.close<c.open&&d.slice(k+1,Math.min(i+1,k+5)).some(x=>x.close>c.high+atr*.2))ob.push({side:"BUY",low:c.low,high:Math.max(c.open,c.close),i:k});if(k<i&&c.close>c.open&&d.slice(k+1,Math.min(i+1,k+5)).some(x=>x.close<c.low-atr*.2))ob.push({side:"SELL",low:Math.min(c.open,c.close),high:c.high,i:k});if(d[k].low>d[k-2].high)fvg.push({side:"BUY",low:d[k-2].high,high:d[k].low,i:k});if(d[k].high<d[k-2].low)fvg.push({side:"SELL",low:d[k].high,high:d[k-2].low,i:k});}return{ob,fvg};}
function makeIndicators(d){let close=d.map(x=>x.close);return{e9:emaSeries(close,9),e20:emaSeries(close,20),e50:emaSeries(close,50),rsi:rsiSeries(close,14),atr:atrSeries(d,14),adx:adxSeries(d,14),bb:bollingerSeries(close,20,2)};}
function structureAt(d,i,x){
 const c=d[i],prev=d[i-1],atr=x.atr[i];
 if(!c||!prev||!atr||x.rsi[i]==null)return{annotations:[],signal:null,projection:null};
 const piv=pivotsAt(d,i-2),hi=lastPivot(piv.highs),lo=lastPivot(piv.lows),priorHi=piv.highs.length>1?piv.highs.at(-2):null,priorLo=piv.lows.length>1?piv.lows.at(-2):null;
 const z=getZones(d,i,atr),ann=[];
 const mark=(type,price,label,side,time=c.time)=>{if(Number.isFinite(price))ann.push({type,price,label,side,time});};
 piv.highs.slice(-8).forEach(p=>mark("pivot",p.price,"PIVOTE ALTO","",d[p.i].time));
 piv.lows.slice(-8).forEach(p=>mark("pivot",p.price,"PIVOTE BAJO","",d[p.i].time));
 if(hi)mark("liquidity",hi.price,"LIQUIDEZ BSL","",d[hi.i].time);
 if(lo)mark("liquidity",lo.price,"LIQUIDEZ SSL","",d[lo.i].time);
 ["BUY","SELL"].forEach(side=>{const v=z.ob.filter(v=>v.side===side).at(-1);if(v){mark("ob",v.low,"OB "+side,v.side,d[v.i].time);mark("ob",v.high,"",v.side,d[v.i].time);}});
 z.fvg.slice(-4).forEach(v=>{mark("fvg",v.low,"FVG "+v.side,v.side,d[v.i].time);mark("fvg",v.high,"",v.side,d[v.i].time);});
 let bos=null;
 if(hi&&c.close>hi.price&&prev.close<=hi.price)bos="BULL";
 if(lo&&c.close<lo.price&&prev.close>=lo.price)bos="BEAR";
 if(bos==="BEAR")mark("bos",lo.price,"BOS BEAR",bos,d[lo.i].time);
 // Buscar barridos recientes: el sweep puede ocurrir antes de la ruptura, no tiene que ser en la misma vela.
 let sweepBuy=null,sweepSell=null;
 for(let k=Math.max(65,i-12);k<i;k++){
  const kp=pivotsAt(d,k-2),kl=lastPivot(kp.lows),kh=lastPivot(kp.highs),bar=d[k];
  if(kl&&bar.low<kl.price&&bar.close>kl.price)sweepBuy={index:k,level:kl.price,time:bar.time};
  if(kh&&bar.high>kh.price&&bar.close<kh.price)sweepSell={index:k,level:kh.price,time:bar.time};
 }
 const sweptLow=!!sweepBuy&&i-sweepBuy.index<=12,sweptHigh=!!sweepSell&&i-sweepSell.index<=12;
 if(sweptLow)mark("sweep",sweepBuy.level,"SWEEP LOW","BUY",sweepBuy.time);
 if(sweptHigh)mark("sweep",sweepSell.level,"SWEEP HIGH","SELL",sweepSell.time);
 // CHoCH se confirma cuando, después del barrido, el precio rompe estructura en sentido contrario al movimiento que barrió.
 const chochBuy=sweptLow&&bos==="BULL"&&priorLo&&lo&&lo.price<priorLo.price;
 const chochSell=sweptHigh&&bos==="BEAR"&&priorHi&&hi&&hi.price>priorHi.price;
 if(chochBuy)mark("choch",hi.price,"CHoCH ALCISTA","BULL",d[hi.i].time);
 if(chochSell)mark("choch",lo.price,"CHoCH BAJISTA","BEAR",d[lo.i].time);
 const crossRecent=(side,sweepIndex)=>{
  const from=Math.max(65,sweepIndex??i-8,i-8);
  for(let k=from;k<=i;k++){
   if(side==="BUY"&&x.e9[k]>x.e20[k]&&x.e9[k-1]<=x.e20[k-1])return true;
   if(side==="SELL"&&x.e9[k]<x.e20[k]&&x.e9[k-1]>=x.e20[k-1])return true;
  }
  return false;
 };
 const emaBuy=x.e9[i]>x.e20[i]&&x.e20[i]>x.e50[i]&&x.e9[i]>x.e9[i-1]&&x.e20[i]>=x.e20[i-1]&&c.close>x.e50[i]&&crossRecent("BUY",sweepBuy?.index);
 const emaSell=x.e9[i]<x.e20[i]&&x.e20[i]<x.e50[i]&&x.e9[i]<x.e9[i-1]&&x.e20[i]<=x.e20[i-1]&&c.close<x.e50[i]&&crossRecent("SELL",sweepSell?.index);
 const obBuy=z.ob.some(v=>v.side==="BUY"&&c.low<=v.high&&c.close>=v.low),fvgBuy=z.fvg.some(v=>v.side==="BUY"&&c.low<=v.high&&c.close>=v.low);
 const obSell=z.ob.some(v=>v.side==="SELL"&&c.high>=v.low&&c.close<=v.high),fvgSell=z.fvg.some(v=>v.side==="SELL"&&c.high>=v.low&&c.close<=v.high);
 const bbBuy=d.slice(Math.max(0,i-5),i+1).some((v,j)=>{const b=x.bb[Math.max(0,i-5)+j];return b&&v.low<=b.lower;})&&c.close>x.bb[i].lower;
 const bbSell=d.slice(Math.max(0,i-5),i+1).some((v,j)=>{const b=x.bb[Math.max(0,i-5)+j];return b&&v.high>=b.upper;})&&c.close<x.bb[i].upper;
 const buy=sweptLow&&reject(c,true)&&chochBuy&&emaBuy&&x.rsi[i]>50&&obBuy;
 const sell=sweptHigh&&reject(c,false)&&chochSell&&emaSell&&x.rsi[i]<50&&obSell;
 let signal=null;
 if(buy||sell){
  const direction=buy?"COMPRAR":"VENDER",entry=c.close,sl=buy?Math.min(c.low,sweepBuy.level)-atr*strategyConfig.slBufferAtr:Math.max(c.high,sweepSell.level)+atr*strategyConfig.slBufferAtr,risk=Math.abs(entry-sl);
  const targets=buy?piv.highs.filter(p=>p.price>entry).map(p=>p.price).sort((a,b)=>a-b):piv.lows.filter(p=>p.price<entry).map(p=>p.price).sort((a,b)=>b-a);
  const structuralTp1=targets.find(v=>Math.abs(v-entry)>=risk*1.2),tp1=structuralTp1||(buy?entry+risk*1.5:entry-risk*1.5);
  const structuralTp2=targets.find(v=>Math.abs(v-entry)>=risk*2&&(buy?v>tp1:v<tp1)),tp2=structuralTp2||(buy?entry+risk*2.5:entry-risk*2.5);
  if(risk>0&&Number.isFinite(tp1)&&Number.isFinite(tp2))signal={direction,entry,sl,tp1,tp2,rsi:x.rsi[i],adx:x.adx.adx[i],time:c.time,index:i,mode:"Liquidez + OB alcista/bajista + rechazo + CHoCH/BOS + EMA 9/20/50 + RSI",emaPeriods:[9,20,50]};
 }
 let projection=null,bias=x.e9[i]>x.e20[i]&&x.e20[i]>x.e50[i]?"BUY":x.e9[i]<x.e20[i]&&x.e20[i]<x.e50[i]?"SELL":null;
 if(bias){
  const pool=bias==="BUY"?lo:hi,zones=bias==="BUY"?z.ob.filter(v=>v.side==="BUY").concat(z.fvg.filter(v=>v.side==="BUY")):z.ob.filter(v=>v.side==="SELL").concat(z.fvg.filter(v=>v.side==="SELL"));
  const zone=zones.at(-1);
  if(pool&&zone){
   const low=Math.min(zone.low,zone.high),high=Math.max(zone.low,zone.high);
   projection={direction:bias==="BUY"?"COMPRAR":"VENDER",low,high,liquidity:pool.price,stage:c.close>=low&&c.close<=high?"PRECIO EN ZONA":"EN PREPARACIÓN",reason:"Zona OB/FVG alineada con EMA 9/20/50. Vigilar barrido, rechazo y ruptura estructural."};
  }
 }
 if(signal){mark("signal",signal.entry,signal.direction,signal.direction==="COMPRAR"?"BUY":"SELL");projection={...signal,low:signal.entry,high:signal.entry,stage:"SEÑAL CONFIRMADA"};}
 return{annotations:ann,signal,projection};
}
function buildZoneOutlook(d,i,x){
 if(!d[i]||!x.atr[i])return{buy:null,sell:null};
 const p=pivotsAt(d,i-2),lo=lastPivot(p.lows),hi=lastPivot(p.highs),z=getZones(d,i,x.atr[i]),atr=x.atr[i];
 const make=side=>{const ob=z.ob.filter(v=>v.side===side).at(-1);if(!ob)return null;const low=Math.min(ob.low,ob.high),high=Math.max(ob.low,ob.high),buy=side==="BUY",entry=buy?high:low,stopPool=buy?lo:hi,targetPool=buy?hi:lo;
 const sl=stopPool&&((buy&&stopPool.price<entry)||(!buy&&stopPool.price>entry))?stopPool.price+(buy?-1:1)*atr*.08:(buy?low-atr*.15:high+atr*.15),risk=Math.abs(entry-sl);
 const tp=targetPool&&((buy&&targetPool.price>entry)||(!buy&&targetPool.price<entry))?targetPool.price+(buy?1:-1)*atr*.1:(buy?entry+risk*2:entry-risk*2);
 return{direction:buy?"COMPRAR":"VENDER",low,high,entry,sl,tp,source:buy?"OB ALCISTA":"OB BAJISTA",reason:buy?"Entrada en borde superior. SL en liquidez SSL inferior. TP apenas por encima de liquidez BSL.":"Entrada en borde inferior. SL en liquidez BSL superior. TP apenas por debajo de liquidez SSL."};};
 return{buy:make("BUY"),sell:make("SELL")};
}
function renderProjectionCard(zones){
 const a=document.getElementById("projection-card"),s=document.getElementById("projection-status");if(!a)return;
 const list=[zones?.buy,zones?.sell].filter(Boolean);
 if(!list.length){a.className="empty-state";a.textContent="Esperando un OB válido en M5.";if(s)s.textContent="ANALIZANDO";return;}
 a.className="zone-outlook-list";
 a.innerHTML=list.map(p=>{const buy=p.direction==="COMPRAR";return '<article class="projection-card '+(buy?"projection-buy":"projection-sell")+'"><div class="projection-stage '+(buy?"buy":"sell")+'">'+(buy?"OB ALCISTA · COMPRA":"OB BAJISTA · VENTA")+'</div><div class="projection-meta"><b>ENTRADA OB:</b> '+fmt(p.entry)+'<br><b>SL LIQUIDEZ:</b> '+fmt(p.sl)+'<br><b>TP LIQUIDEZ:</b> '+fmt(p.tp)+'<br><span class="zone-source">'+p.source+' · '+fmt(p.low)+' — '+fmt(p.high)+'</span><br>'+p.reason+'<br><b>CONFIRMACIÓN PENDIENTE · NO ENTRAR SOLO POR TOQUE</b></div></article>';}).join("");
 if(s)s.textContent="OB M5 · ENTRADA / SL / TP";
}
function computeTrade(d,s,i){let t={...s,entryTime:d[i].time*1000,tp1Hit:false};for(let j=i+1;j<d.length;j++){let c=d[j],stop=s.direction==="COMPRAR"?c.low<=s.sl:c.high>=s.sl,one=s.direction==="COMPRAR"?c.high>=s.tp1:c.low<=s.tp1,two=s.direction==="COMPRAR"?c.high>=s.tp2:c.low<=s.tp2;if(stop){t.result="PERDIDA";t.price=s.sl;t.exitTime=c.time*1000;return t;}if(one)t.tp1Hit=true;if(two){t.result="GANADA";t.price=s.tp2;t.exitTime=c.time*1000;return t;}}t.result="ABIERTA";return t;}
function setBacktestTrades(trades){backtestTradeData=trades.slice();if(typeof drawMarketChart==="function")drawMarketChart();const closed=trades.filter(t=>t.result==="GANADA"||t.result==="PERDIDA"),wins=closed.filter(t=>t.result==="GANADA").length,losses=closed.length-wins;setText("bt-wins",wins);setText("bt-losses",losses);setText("bt-total",trades.length);setText("bt-rate",closed.length?(wins/closed.length*100).toFixed(1)+"%":"0%");setText("bt-open",trades.filter(t=>t.result==="ABIERTA").length);}
function runBacktest(symbol,market,candles){if(!Array.isArray(candles)||candles.length<100){setText("chart-message","Esperando al menos 100 velas M1 para el backtesting.");return;}let d=candles.slice().sort((a,b)=>a.time-b.time),x=makeIndicators(d),trades=[],annotations=[],nextFree=-1;for(let i=65;i<d.length-1;i++){let r=structureAt(d,i,x);annotations.push(...r.annotations);if(r.signal){annotations.push({type:"signal",price:r.signal.entry,label:r.signal.direction,side:r.signal.direction,time:d[i].time});if(i>nextFree){let t=computeTrade(d,r.signal,i);trades.push({...t,symbol,market});nextFree=t.exitTime?Math.max(i,d.findIndex(v=>v.time*1000===t.exitTime)):i;}}}backtestTrades.splice(0,backtestTrades.length,...trades);setBacktestTrades(trades);if(typeof setStructureOverlay==="function")setStructureOverlay({items:annotations,projection:null});backtestSymbol=symbol;backtestReady=true;updateDailyPanel();drawRsiPanel(x.rsi,d);let closed=trades.filter(t=>t.result==="GANADA"||t.result==="PERDIDA"),wins=closed.filter(t=>t.result==="GANADA").length;setText("chart-message","Backtesting M1 · "+trades.length+" señales · "+closed.length+" cerradas · "+wins+" ganadas · "+(closed.length-wins)+" perdidas.");}
function notifyBot(title,body){if("Notification" in window&&Notification.permission==="granted")new Notification(title,{body});}
function activateAlerts(){if(!("Notification" in window)){setText("alert-status","Este navegador no admite notificaciones.");return;}Notification.requestPermission().then(p=>setText("alert-status",p==="granted"?"ALERTAS ACTIVADAS":"PERMISO NO CONCEDIDO"));}
function aggregateStructureM5(candles){
 const buckets=new Map();
 candles.forEach((c,i)=>{const time=Math.floor(c.time/300)*300;let b=buckets.get(time);if(!b){b={time,open:c.open,high:c.high,low:c.low,close:c.close,_sourceIndex:i};buckets.set(time,b);}else{b.high=Math.max(b.high,c.high);b.low=Math.min(b.low,c.low);b.close=c.close;b._sourceIndex=i;}});
 return [...buckets.values()].sort((a,b)=>a.time-b.time);
}
function analyzeCandles(symbol,market,candles){
 if(!Array.isArray(candles)||candles.length<100)return;
 const d=candles.slice().sort((a,b)=>a.time-b.time),x=makeIndicators(d),i=d.length-2;
 const r=structureAt(d,i,x);
 evaluateOpenOperations(symbol,d[i]);
 if(r.signal){const live=candles.at(-1);if(live&&live.time>d[i].time&&live.close>=r.signal.entry){}}
 // Las zonas y estructura se calculan en M5; las entradas y filtros permanecen en M1.
 const m5=aggregateStructureM5(d),mx=makeIndicators(m5),mi=m5.length-2;
 let structureItems=[],structureProjection=null,zoneOutlook=null;
 if(mi>=65){
  const last=structureAt(m5,mi,mx);structureProjection=last.projection;zoneOutlook=buildZoneOutlook(m5,mi,mx);
  for(let k=65;k<=mi;k++){
   const part=structureAt(m5,k,mx);structureItems.push(...part.annotations);
  }
 }
 // Señal de entrada M1: se añade sin llenar el gráfico de marcas históricas.
 if(r.signal)structureItems.push(...r.annotations.filter(v=>v.type==="signal"));
 const unique=[...new Map(structureItems.map(v=>[v.type+"|"+v.time+"|"+v.price+"|"+v.label,v])).values()];
 lastProjection=structureProjection;renderProjectionCard(zoneOutlook);
 const counts={pivot:unique.filter(a=>a.type==="pivot").length,liquidity:unique.filter(a=>a.type==="liquidity").length,bos:unique.filter(a=>a.type==="bos").length,choch:unique.filter(a=>a.type==="choch").length,ob:unique.filter(a=>a.type==="ob").length/2,fvg:unique.filter(a=>a.type==="fvg").length/2};
 setText("structure-diagnostic","Estructura M5 · "+counts.pivot+" pivotes · "+counts.liquidity+" liquidez · "+counts.bos+" BOS · "+counts.choch+" CHoCH · "+counts.ob+" OB · "+counts.fvg+" FVG");
 setText("side-analysis-status","● Estructura M5 · Entrada M1");
 if(typeof setStructureOverlay==="function")setStructureOverlay({items:unique,projection:structureProjection});
 drawRsiPanel(x.rsi,d);
 const stage=structureProjection?structureProjection.stage:"SIN ZONA",notice=symbol+":"+stage+":"+(structureProjection?.direction||"");
 if(structureProjection&&stage==="PRECIO EN ZONA"&&notice!==lastProjectionNotice)notifyBot("Botder: precio en zona",structureProjection.direction+" · "+fmt(structureProjection.low)+" – "+fmt(structureProjection.high));
 lastProjectionNotice=notice;
 if(!r.signal)return;
 const key=symbol+":"+r.signal.time+":"+r.signal.direction;if(key===lastSignalKey)return;
 lastSignalKey=key;addSignal({...r.signal,symbol,market,candleTime:r.signal.time});
 notifyBot("Botder: señal confirmada",r.signal.direction+" · Entrada "+fmt(r.signal.entry)+" · SL "+fmt(r.signal.sl));
 if(typeof drawTradeLevels==="function")drawTradeLevels(r.signal);
}
function drawRsiPanel(series){let host=document.getElementById("rsi-area");if(!host)return;host.innerHTML="";let cv=document.createElement("canvas");cv.style.cssText="width:100%;height:100%;display:block";host.appendChild(cv);let dpr=Math.min(devicePixelRatio||1,2),w=host.clientWidth,h=host.clientHeight;cv.width=w*dpr;cv.height=h*dpr;let x=cv.getContext("2d");x.scale(dpr,dpr);for(let level of [40,50,60]){let y=10+(100-level)/100*(h-28);x.strokeStyle=level===50?"#8495aa":"#43546b";x.setLineDash([4,3]);x.beginPath();x.moveTo(24,y);x.lineTo(w-8,y);x.stroke();x.setLineDash([]);x.fillStyle="#a8b5c6";x.font="9px Arial";x.fillText(String(level),2,y+3);}x.beginPath();let st=Math.max(0,series.length-200),beg=false;for(let i=st;i<series.length;i++){if(series[i]==null)continue;let px=24+(i-st)/Math.max(1,series.length-st-1)*(w-32),py=10+(100-series[i])/100*(h-28);if(!beg){x.moveTo(px,py);beg=true;}else x.lineTo(px,py);}x.strokeStyle="#48a8ff";x.lineWidth=1.7;x.stroke();setText("rsi-current","RSI: "+(series.at(-1)==null?"--":series.at(-1).toFixed(1)));}
function drawAdxPanel(data){let host=document.getElementById("adx-area");if(!host||!data)return;host.innerHTML="";let cv=document.createElement("canvas");cv.style.cssText="width:100%;height:100%;display:block";host.appendChild(cv);let dpr=Math.min(devicePixelRatio||1,2),w=host.clientWidth,h=host.clientHeight;cv.width=w*dpr;cv.height=h*dpr;let c=cv.getContext("2d");c.scale(dpr,dpr);let left=28,right=8,top=10,bottom=18,vals=[...data.adx,...data.pdi,...data.mdi].filter(Number.isFinite),max=Math.max(40,...vals);for(let v of [20,40]){let y=top+(max-v)/max*(h-top-bottom);c.strokeStyle="#43546b";c.setLineDash([4,3]);c.beginPath();c.moveTo(left,y);c.lineTo(w-right,y);c.stroke();c.setLineDash([]);c.fillStyle="#a8b5c6";c.font="9px Arial";c.fillText(String(v),3,y+3);}let st=Math.max(0,data.adx.length-200);[[data.adx,"#f5bd4f"],[data.pdi,"#20c997"],[data.mdi,"#ff5364"]].forEach(([arr,col])=>{c.beginPath();let b=false;for(let i=st;i<arr.length;i++){if(arr[i]==null)continue;let px=left+(i-st)/Math.max(1,arr.length-st-1)*(w-left-right),py=top+(max-arr[i])/max*(h-top-bottom);if(!b){c.moveTo(px,py);b=true;}else c.lineTo(px,py);}c.strokeStyle=col;c.lineWidth=1.5;c.stroke();});}
function optimizeBacktest(){setText("optimizer-result","Validación pendiente: no se optimizan parámetros para forzar un porcentaje de acierto.");}
function setAnalysisGranularity(){analysisGranularity=60;}
function setBacktestHistory(symbol,market,candles){if(!candles?.length)return;m1Candles=candles.slice();runBacktest(symbol,market,m1Candles);}
function updateBacktestTick(epoch,price){if(!Number.isFinite(epoch)||!Number.isFinite(price)||!m1Candles.length)return;let bucket=Math.floor(epoch/60)*60,last=m1Candles.at(-1);if(last&&last.time===bucket)m1Candles[m1Candles.length-1]={...last,high:Math.max(last.high,price),low:Math.min(last.low,price),close:price};else if(!last||bucket>last.time){m1Candles.push({time:bucket,open:price,high:price,low:price,close:price});runBacktest(backtestSymbol||selectedMarket?.symbol,selectedMarket?.name||"",m1Candles);}}
document.addEventListener("DOMContentLoaded",()=>{if(typeof createMarketChart==="function")createMarketChart();updateDailyPanel();setInterval(updateDailyPanel,1000);});
