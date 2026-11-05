/* BOTDER SMC ENGINE · FVG + SSL/BSL + EMA 9/20/50 · timeframe-isolated */
var structuralBacktestValidatedKey="",structuralBacktestRunningKey="",structuralBacktestRunId=0;
var botderAnalyzedBars = (typeof botderAnalyzedBars!=="undefined" && botderAnalyzedBars instanceof Map) ? botderAnalyzedBars : new Map();
var botderSignalKeys = new Set();

function botderLabel(tf){return tf===30?"S30":tf>=3600?"H"+tf/3600:"M"+tf/60;}
function botderAggregate(candles,seconds){
 const out=[];
 for(const c of candles||[]){
  const time=Math.floor(c.time/seconds)*seconds,last=out[out.length-1];
  if(last&&last.time===time){last.high=Math.max(last.high,c.high);last.low=Math.min(last.low,c.low);last.close=c.close;}
  else out.push({time,open:c.open,high:c.high,low:c.low,close:c.close});
 }
 return out;
}
function botderEma(values,period){
 const out=Array(values.length).fill(null);if(values.length<period)return out;
 let e=values.slice(0,period).reduce((a,b)=>a+b,0)/period,k=2/(period+1);out[period-1]=e;
 for(let i=period;i<values.length;i++){e=values[i]*k+e*(1-k);out[i]=e;}return out;
}
function botderPivots(d,end,depth=2){
 const highs=[],lows=[];
 for(let i=depth;i<=end-depth;i++){
  let hi=true,lo=true;
  for(let k=1;k<=depth;k++){if(d[i].high<=d[i-k].high||d[i].high<d[i+k].high)hi=false;if(d[i].low>=d[i-k].low||d[i].low>d[i+k].low)lo=false;}
  if(hi)highs.push({i,time:d[i].time,price:d[i].high});
  if(lo)lows.push({i,time:d[i].time,price:d[i].low});
 }
 return{highs,lows};
}
function botderMedianRange(d,end){
 const a=d.slice(Math.max(0,end-39),end+1).map(c=>c.high-c.low).filter(Number.isFinite).sort((x,y)=>x-y);
 return a.length?a[Math.floor(a.length/2)]:Math.max(1e-8,Math.abs(d[end]?.close||1)*.0001);
}
function botderLiquidity(d,end,pivots){
 const tol=Math.max(botderMedianRange(d,end)*.16,Math.abs(d[end]?.close||1)*1e-7,1e-9);
 const cluster=(items,side)=>{
  const result=[],seen=new Set();
  for(let a=0;a<items.length;a++)for(let b=a+1;b<items.length;b++){
   const p=items[a],q=items[b];if(Math.abs(p.price-q.price)>tol)continue;
   const key=p.i+":"+q.i;if(seen.has(key))continue;seen.add(key);
   const lo=Math.min(p.price,q.price),hi=Math.max(p.price,q.price),last=Math.max(p.i,q.i);
   let swept=false;for(let k=last+1;k<=end;k++){if(side==="SSL"?d[k].low<lo-tol*.1:d[k].high>hi+tol*.1){swept=true;break;}}
   if(swept)continue;
   const group=items.filter(x=>Math.abs(x.price-p.price)<=tol);
   const low=Math.min(...group.map(x=>x.price)),high=Math.max(...group.map(x=>x.price));
   if(result.some(x=>Math.abs(x.level-(side==="SSL"?low:high))<=tol*.35))continue;
   result.push({side,low,high,level:side==="SSL"?low:high,count:group.length,time:d[last].time,index:last,tolerance:tol});
  }
  return result.sort((x,y)=>side==="SSL"?y.level-x.level:x.level-y.level);
 };
 return{ssl:cluster(pivots.lows,"SSL"),bsl:cluster(pivots.highs,"BSL"),tolerance:tol};
}
function botderZones(d,end){
 const ob=[],fvg=[],from=Math.max(2,end-70);
 for(let i=from;i<=end;i++){
  const a=d[i-2],c=d[i],prev=d[i-1];
  if(c.low>a.high)fvg.push({side:"BUY",low:a.high,high:c.low,index:i,time:c.time});
  if(c.high<a.low)fvg.push({side:"SELL",low:c.high,high:a.low,index:i,time:c.time});
 }
 for(let i=Math.max(0,end-75);i<=end-3;i++){
  const base=d[i],future=d.slice(i+1,Math.min(end+1,i+5));if(!future.length)continue;
  const priorHigh=Math.max(...d.slice(Math.max(0,i-12),i).map(x=>x.high),base.high);
  const priorLow=Math.min(...d.slice(Math.max(0,i-12),i).map(x=>x.low),base.low);
  if(base.close<base.open&&future.some(x=>x.close>priorHigh))ob.push({side:"BUY",low:base.low,high:Math.max(base.open,base.close),index:i,time:base.time});
  if(base.close>base.open&&future.some(x=>x.close<priorLow))ob.push({side:"SELL",low:Math.min(base.open,base.close),high:base.high,index:i,time:base.time});
 }
 const liveFvg=fvg.filter(z=>!d.slice(z.index+1,end+1).some(c=>z.side==="BUY"?c.low<=z.low:c.high>=z.high));
 const liveOb=ob.filter(z=>!d.slice(z.index+1,end+1).some(c=>z.side==="BUY"?c.close<z.low:c.close>z.high));
 return{ob:liveOb.slice(-12),fvg:liveFvg.slice(-12)};
}
function botderOverlap(a,b,pad=0){
 return !!a&&!!b&&Math.max(a.low,b.low)<=Math.min(a.high,b.high)+pad;
}
function botderTradeAt(d,i,tf){
 if(i<60||i>=d.length)return null;
 const close=d.slice(0,i+1).map(c=>c.close),e9=botderEma(close,9),e20=botderEma(close,20),e50=botderEma(close,50);
 const c=d[i],emaBull=e9[i]!=null&&e20[i]!=null&&e50[i]!=null&&e9[i]>e20[i]&&e20[i]>e50[i],emaBear=e9[i]!=null&&e20[i]!=null&&e50[i]!=null&&e9[i]<e20[i]&&e20[i]<e50[i];
 const piv=botderPivots(d,i-1,2),liq=botderLiquidity(d,i-1,piv),zones=botderZones(d,i-1),range=botderMedianRange(d,i-1),pad=Math.max(range*.75,liq.tolerance*2);
 const candidate=(side)=>{
  const isBuy=side==="BUY",pool=(isBuy?liq.ssl:liq.bsl).find(p=>c.low<=p.high+pad&&c.high>=p.low-pad);
  if(!pool)return null;
  const ob=zones.ob.filter(z=>z.side===side&&Math.abs(z.index-pool.index)<55&&botderOverlap(z,{low:pool.low-pad,high:pool.high+pad},pad)).at(-1);
  const gap=zones.fvg.filter(z=>z.side===side&&Math.abs(z.index-pool.index)<55&&botderOverlap(z,{low:pool.low-pad,high:pool.high+pad},pad)).at(-1);
  if(!ob||!gap||(isBuy?!emaBull:!emaBear))return null;
  const entry=pool.level;
  const opposite=(isBuy?liq.bsl:liq.ssl).filter(p=>isBuy?p.level>entry:p.level<entry).sort((a,b)=>isBuy?a.level-b.level:b.level-a.level);
  if(opposite.length<2)return null;
  const sl=isBuy?pool.low-Math.max(range*.35,liq.tolerance*.5):pool.high+Math.max(range*.35,liq.tolerance*.5);
  const tp1=opposite[0].level,tp2=opposite[1].level;
  if(isBuy?!(sl<entry&&tp1>entry&&tp2>tp1):!(sl>entry&&tp1<entry&&tp2<tp1))return null;
  const touches=pool.count,score=Math.min(100,25+25+25+Math.min(25,15+(touches-2)*5));
  const risk=Math.abs(entry-sl),reward=Math.abs(tp1-entry);
  if(!risk||reward/risk<1.05)return null;
  return{direction:isBuy?"COMPRAR":"VENDER",entry,sl,tp1,tp2,time:c.time,index:i,timeframe:botderLabel(tf),timeframeSeconds:tf,confidence:score,scoreLabel:"CONFLUENCIA",mode:(isBuy?"OB ALCISTA + FVG + SSL":"OB BAJISTA + FVG + BSL")+" · EMA 9/20/50",pool,ob,gap,ema:{e9:e9[i],e20:e20[i],e50:e50[i]},rr:reward/risk};
 };
 return candidate("BUY")||candidate("SELL");
}
function botderAnnotations(d,end,tf){
 const items=[],zones=botderZones(d,end),piv=botderPivots(d,end-1,2),liq=botderLiquidity(d,end-1,piv);
 const markZone=(z,type)=>{items.push({type,price:z.low,label:type==="ob"?(z.side==="BUY"?"OB ALCISTA":"OB BAJISTA"):(z.side==="BUY"?"FVG ALCISTA":"FVG BAJISTA"),side:z.side,time:z.time,tf});items.push({type,price:z.high,label:"",side:z.side,time:z.time,tf});};
 zones.ob.slice(-5).forEach(z=>markZone(z,"ob"));zones.fvg.slice(-5).forEach(z=>markZone(z,"fvg"));
 liq.ssl.slice(0,4).forEach(z=>items.push({type:"liquidity",price:z.level,label:"SSL",side:"SSL",time:z.time,tf}));
 liq.bsl.slice(0,4).forEach(z=>items.push({type:"liquidity",price:z.level,label:"BSL",side:"BSL",time:z.time,tf}));
 return items;
}
function botderScoreSignal(s){
 return s?Math.max(0,Math.min(100,Math.round(s.confidence))):0;
}
function botderBacktest(d,tf,symbol,market){
 const trades=[],seen=new Set();let nextAvailable=60;
 for(let i=60;i<d.length-1;i++){
  if(i<nextAvailable)continue;
  const s=botderTradeAt(d,i,tf);if(!s)continue;
  const key=[tf,s.direction,s.pool.time,s.pool.level.toPrecision(12)].join(":");if(seen.has(key))continue;seen.add(key);
  let result="ABIERTA",exitPrice=null,exitTime=0,exitReason="SIN CIERRE";
  for(let j=i+1;j<d.length;j++){
   const b=d[j],stop=s.direction==="COMPRAR"?b.low<=s.sl:b.high>=s.sl,one=s.direction==="COMPRAR"?b.high>=s.tp1:b.low<=s.tp1,two=s.direction==="COMPRAR"?b.high>=s.tp2:b.low<=s.tp2;
   if(stop){result="PERDIDA";exitPrice=s.sl;exitTime=b.time*1000;exitReason="SL ESTRUCTURAL";break;}
   if(two){result="GANADA";exitPrice=s.tp2;exitTime=b.time*1000;exitReason="TP2 LIQUIDEZ";break;}
   if(one){result="GANADA";exitPrice=s.tp1;exitTime=b.time*1000;exitReason="TP1 LIQUIDEZ";break;}
  }
  trades.push({...s,id:"BT-"+symbol+"-"+tf+"-"+s.time,symbol,market,result,exitPrice,price:exitPrice,entryTime:s.time*1000,zoneTime:s.time*1000,exitTime,exitReason,entered:true});
  nextAvailable=exitTime?Math.max(i+1,d.findIndex((x,k)=>k>i&&x.time*1000>=exitTime)):d.length;
 }
 return trades;
}
function setBacktestTrades(trades){
 if(typeof backtestTrades!=="undefined"){backtestTrades.splice(0,backtestTrades.length,...trades);}
 if(typeof setChartBacktestTrades==="function")setChartBacktestTrades(trades);
 const closed=trades.filter(t=>t.result==="GANADA"||t.result==="PERDIDA"),wins=closed.filter(t=>t.result==="GANADA").length;
 setText("bt-total",trades.length);setText("bt-wins",wins);setText("bt-losses",closed.length-wins);setText("bt-rate",closed.length?(wins/closed.length*100).toFixed(1)+"%":"0%");setText("bt-open",trades.filter(t=>t.result==="ABIERTA").length);
}
function buildStructuralPlan(baseCandles,displayTf){
 const tf=Number(displayTf)||60,source=tf===30?botderAggregate(baseCandles,150):baseCandles.slice(),label=tf===30?"S30 · MOTOR 150s":botderLabel(tf),i=source.length-2;
 if(i<60)return{items:[],lines:[],projection:null,signal:null,status:"CARGANDO HISTORIAL",activeSource:source,bias4:null,recommendation:"ESPERANDO"};
 const items=botderAnnotations(source,i,tf),signal=botderTradeAt(source,i,tf);
 let projection=null;
 if(signal){
  projection={direction:signal.direction,entry:signal.entry,sl:signal.sl,tp1:signal.tp1,tp2:signal.tp2,zoneLow:signal.pool.low,zoneHigh:signal.pool.high,low:signal.pool.low,high:signal.pool.high,stage:"OPORTUNIDAD "+signal.confidence+"%",timeframe:label,confidence:signal.confidence,reason:signal.mode};
  items.push({type:"signal",price:signal.entry,label:signal.direction,side:signal.direction,time:signal.time,tf});
 }
 return{items,lines:[],ema,projection,signal:signal?{...signal,timeframe:label}:null,status:signal?"OPORTUNIDAD DETECTADA":"ESPERANDO CONFLUENCIA",activeSource:source,bias4:null,recommendation:"EMA 9/20/50 + OB + FVG + LIQUIDEZ",activeTf:tf};
}
function runStructuralBacktest(symbol,market,candles,displayTf){
 const tf=Number(displayTf)||60,key=symbol+":"+tf;
 if(structuralBacktestRunningKey===key||structuralBacktestValidatedKey===key)return[];
 const runId=++structuralBacktestRunId;structuralBacktestRunningKey=key;
 const raw=candles.slice().sort((a,b)=>a.time-b.time),d=tf===30?botderAggregate(raw,150):raw;
 const trades=botderBacktest(d,tf===30?150:tf,symbol,market).map(t=>({...t,timeframe:botderLabel(tf),timeframeSeconds:tf,sourceSeconds:tf===30?150:tf}));
 const complete=()=>{if(runId!==structuralBacktestRunId)return;if(typeof selectedSymbol!=="undefined"&&selectedSymbol&&selectedSymbol!==symbol){structuralBacktestRunningKey="";return;}if(Number(document.getElementById("timeframe")?.value||tf)!==tf){structuralBacktestRunningKey="";return;}
  if(typeof backtestTrades!=="undefined")backtestTrades.splice(0,backtestTrades.length,...trades);
  setBacktestTrades(trades);if(typeof setStructureOverlay==="function")const cv=d.map(c=>c.close),ema=[{name:"EMA 9",color:"#ffd166",values:botderEma(cv,9)},{name:"EMA 20",color:"#61b7ff",values:botderEma(cv,20)},{name:"EMA 50",color:"#bd8cff",values:botderEma(cv,50)}].map(x=>({name:x.name,color:x.color,points:x.values.map((price,k)=>price==null?null:{time:d[k].time,price}).filter(Boolean).slice(-180)}));
  setStructureOverlay({items:botderAnnotations(d,d.length-1,tf),lines:[],ema,projection:null,activeTf:tf});
  structuralBacktestValidatedKey=key;structuralBacktestRunningKey="";backtestSymbol=symbol;backtestReady=true;
  setText("chart-message","BACKTEST "+botderLabel(tf)+" · "+d.length+" velas · "+trades.length+" operaciones evaluadas.");
  if(typeof renderStrategyJournal==="function")renderStrategyJournal();
 };
 if(d.length>1800){let offset=0,all=[];const chunk=()=>{if(runId!==structuralBacktestRunId)return;const end=Math.min(d.length,offset+1800);const part=botderBacktest(d.slice(0,end),tf===30?150:tf,symbol,market);all=part;offset=end;if(offset<d.length){setTimeout(chunk,0);return;}trades.splice(0,trades.length,...all.map(t=>({...t,timeframe:botderLabel(tf),timeframeSeconds:tf,sourceSeconds:tf===30?150:tf})));complete();};chunk();}
 else complete();
 return trades;
}
function saveStrategyJournal(){try{localStorage.setItem("botder-structure-journal",JSON.stringify(strategyJournal.slice(0,2000)));}catch(e){}}
function loadStrategyJournal(){try{const saved=JSON.parse(localStorage.getItem("botder-structure-journal")||"[]");if(Array.isArray(saved))strategyJournal=saved.slice(0,2000);}catch(e){strategyJournal=[];}renderStrategyJournal();}
function recordStrategyTrade(signal){
 if(!signal||strategyJournal.some(t=>t.symbol===signal.symbol&&t.structureKey===signal.structureKey))return;
 strategyJournal.unshift({id:"STR-"+Date.now().toString(36).toUpperCase(),symbol:signal.symbol,market:signal.market,direction:signal.direction,entry:signal.entry,sl:signal.sl,tp1:signal.tp1,tp2:signal.tp2,timeframe:signal.timeframe,timeframeSeconds:signal.timeframeSeconds,confidence:signal.confidence,scoreLabel:signal.scoreLabel,structureKey:signal.structureKey,entryTime:signal.time*1000,entered:true,result:"ABIERTA"});
 strategyJournal=strategyJournal.slice(0,2000);saveStrategyJournal();renderStrategyJournal();
}
function evaluateStrategyJournal(symbol,candle){
 if(!candle)return;let changed=false;
 strategyJournal.forEach(t=>{if(t.symbol!==symbol||t.result!=="ABIERTA"||candle.time*1000<=t.entryTime)return;
  const stop=t.direction==="COMPRAR"?candle.low<=t.sl:candle.high>=t.sl,one=t.direction==="COMPRAR"?candle.high>=t.tp1:candle.low<=t.tp1,two=t.direction==="COMPRAR"?candle.high>=t.tp2:candle.low<=t.tp2;
  if(stop||one||two){t.result=stop?"PERDIDA":"GANADA";t.exitPrice=stop?t.sl:two?t.tp2:t.tp1;t.exitTime=candle.time*1000;t.exitReason=stop?"SL ESTRUCTURAL":two?"TP2 LIQUIDEZ":"TP1 LIQUIDEZ";changed=true;}
 });
 if(changed){saveStrategyJournal();renderStrategyJournal();}
}
function renderStrategyJournal(){
 const bt=typeof backtestTrades!=="undefined"?backtestTrades:[],closed=bt.filter(t=>t.result==="GANADA"||t.result==="PERDIDA"),wins=closed.filter(t=>t.result==="GANADA").length;
 setText("bt-total",bt.length);setText("bt-wins",wins);setText("bt-losses",closed.length-wins);setText("bt-rate",closed.length?(wins/closed.length*100).toFixed(1)+"%":"0%");setText("bt-open",bt.filter(t=>t.result==="ABIERTA").length+strategyJournal.filter(t=>t.result==="ABIERTA").length);
 if(typeof setChartBacktestTrades==="function")setChartBacktestTrades([...bt,...strategyJournal.map(t=>({...t,entryTime:t.entryTime||0,exitTime:t.exitTime||0,zoneTime:t.entryTime||0}))]);
 const area=document.getElementById("history");if(!area)return;
 const rows=[...bt.map(t=>({...t,_src:"BACKTEST"})),...strategyJournal.map(t=>({...t,_src:"SEÑAL EN VIVO"}))].sort((a,b)=>Number(b.entryTime)-Number(a.entryTime)).slice(0,300);
 const safe=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 area.innerHTML=rows.length?rows.map(t=>'<article class="history-row"><div><strong>'+safe(t.market||t.symbol)+' · '+safe(t.direction)+' · '+safe(t.timeframe||"")+'</strong><small>'+new Date(Number(t.entryTime)||Date.now()).toLocaleString("es-PA",{dateStyle:"short",timeStyle:"short"})+' · '+safe(t._src)+' · ENTRADA '+fmt(t.entry)+' · SL '+fmt(t.sl)+' · TP1 '+fmt(t.tp1)+' · TP2 '+fmt(t.tp2)+' · CONFLUENCIA '+Number(t.confidence||0)+'%'+(t.exitReason?' · '+safe(t.exitReason):'')+'</small></div><span class="history-result '+safe(t.result)+'">'+safe(t.result)+'</span></article>').join(""):'<div class="empty-state">Aún no hay operaciones para mostrar.</div>';
}
function renderSignals(){
 const active=strategyJournal.filter(t=>t.symbol===(typeof selectedSymbol!=="undefined"?selectedSymbol:t.symbol)&&t.result==="ABIERTA");
 setText("signal-count",active.length);const area=document.getElementById("signals-top");if(!area)return;
 const safe=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 area.innerHTML=active.length?active.map(t=>'<article class="signal-card"><div class="muted">'+safe(t.market)+' · '+safe(t.timeframe)+'</div><h3 class="'+(t.direction==="COMPRAR"?"buy":"sell")+'">'+safe(t.direction)+'</h3><div class="levels"><div class="level"><span>ENTRADA</span><strong>'+fmt(t.entry)+'</strong></div><div class="level"><span>SL ESTRUCTURAL</span><strong>'+fmt(t.sl)+'</strong></div><div class="level"><span>TP1</span><strong>'+fmt(t.tp1)+'</strong></div><div class="level"><span>TP2</span><strong>'+fmt(t.tp2)+'</strong></div></div><div class="muted">'+safe(t.mode||"FVG + SSL/BSL + EMA 9/20/50")+' · CONFLUENCIA '+Number(t.confidence||0)+'%</div></article>').join(""):'<div class="empty-state">Esperando una oportunidad válida; no se generan señales por segundo.</div>';
}
function renderProjection(plan){
 const el=document.getElementById("projection-card"),status=document.getElementById("projection-status");if(!el)return;
 if(!plan?.projection){el.className="projection-empty";el.textContent=plan?.status||"Buscando confluencia FVG + liquidez + EMA";if(status)status.textContent="ANALIZANDO";return;}
 const p=plan.projection,buy=p.direction==="COMPRAR",price=v=>Number.isFinite(Number(v))?fmt(v):"—";
 el.className="projection-card"+(buy?"":" projection-sell");
 el.innerHTML='<div class="projection-stage '+(buy?"":"sell")+'">'+(buy?"COMPRA · SSL":"VENTA · BSL")+'</div><div class="projection-meta">'+safeText(p.stage||"OPORTUNIDAD")+'</div><div class="projection-levels"><div class="projection-level"><span>ENTRADA · EXTREMO DE LIQUIDEZ</span><strong>'+price(p.entry)+'</strong></div><div class="projection-level"><span>SL ESTRUCTURAL</span><strong>'+price(p.sl)+'</strong></div><div class="projection-level"><span>TP1 · LIQUIDEZ</span><strong>'+price(p.tp1)+'</strong></div><div class="projection-level"><span>TP2 · LIQUIDEZ</span><strong>'+price(p.tp2)+'</strong></div></div><div class="projection-meta">PUNTUACIÓN DE CONFLUENCIA: <b>'+Number(p.confidence||0)+'%</b><br>'+safeText(p.reason||"")+'</div>';
 if(status)status.textContent=p.stage||"OPORTUNIDAD";
}
function safeText(v){return String(v??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));}
function analyzeCandles(symbol,market,candles){
 if(!Array.isArray(candles)||candles.length<100)return;
 const tf=Number(document.getElementById("timeframe")?.value)||60,selected=typeof getDisplayCandles==="function"?getDisplayCandles(tf):candles,raw=(selected?.length?selected:candles).slice().sort((a,b)=>a.time-b.time),source=tf===30?botderAggregate(raw,150):raw,bar=source.at(-2);if(!bar)return;
 const key=symbol+":"+tf;if(botderAnalyzedBars.get(key)===bar.time)return;botderAnalyzedBars.set(key,bar.time);
 const plan=buildStructuralPlan(raw,tf);if(typeof evaluateStrategyJournal==="function")evaluateStrategyJournal(symbol,bar);
 lastProjection=plan.projection;setText("side-analysis-status","● "+plan.status);setText("structure-diagnostic",plan.status+" · "+plan.recommendation+" · "+source.length+" velas · EMA 9/20/50");
 setText("trend-h4",plan.signal?.direction||"SIN CONFIRMACIÓN");setText("confirm-m30",plan.recommendation);setText("confirm-m1",plan.signal?"EMA 9/20/50 ALINEADAS":"ESPERANDO CONFLUENCIA");setText("touch-status",plan.signal?"OPORTUNIDAD":"BUSCANDO");setText("ob-status",plan.signal?.direction||"BUSCANDO");setText("channel-status",plan.signal?"FVG + LIQUIDEZ":"BUSCANDO");
 renderProjection(plan);
 const btKey=symbol+":"+tf;
 if(structuralBacktestValidatedKey!==btKey&&structuralBacktestRunningKey!==btKey&&source.length>=120)runStructuralBacktest(symbol,market,raw,tf);
 if(typeof setStructureOverlay==="function")setStructureOverlay({items:plan.items,lines:[],ema:plan.ema,projection:plan.projection,activeTf:tf});
 if(plan.signal&&structuralBacktestValidatedKey===btKey){
  const s=plan.signal,structureKey=[symbol,tf,s.direction,s.pool.time,s.pool.level.toPrecision(12)].join(":");
  if(!botderSignalKeys.has(structureKey)&&!strategyJournal.some(t=>t.structureKey===structureKey)){
   botderSignalKeys.add(structureKey);const full={...s,symbol,market,structureKey};
   addSignal(full);recordStrategyTrade(full);notifyBot("BOTDER · "+s.direction,"Oportunidad "+s.confidence+"% · "+s.mode);
  }
 }
 if(typeof clearTradeLevels==="function")clearTradeLevels();
 if(typeof drawRsiPanel==="function"){const el=document.querySelector(".rsi-strip");if(el)el.style.display="none";}
 renderSignals();renderStrategyJournal();
}
function analyzeLiveStructure(symbol,candles){if(symbol!==selectedMarket?.symbol||!Array.isArray(candles))return;const tf=Number(document.getElementById("timeframe")?.value)||60,selected=typeof getDisplayCandles==="function"?getDisplayCandles(tf):candles,plan=buildStructuralPlan(selected?.length?selected:candles,tf);if(typeof setStructureOverlay==="function")setStructureOverlay({items:plan.items,lines:[],ema:plan.ema,projection:plan.projection,activeTf:tf});}
function setAnalysisGranularity(seconds){analysisGranularity=Number(seconds)||60;}
loadStrategyJournal();
renderStrategyJournal();
renderSignals();
