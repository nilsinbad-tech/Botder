/* BOTDER STRUCTURAL ENGINE v1 · independent timeframe channel model */
let structuralBacktestValidatedKey="";
function structurePivots(d,depth=3,deviation=3,backstep=3){
 const found=[];if(!Array.isArray(d)||d.length<depth*2+3)return{highs:[],lows:[],zigzag:[]};
 for(let i=depth;i<d.length-depth;i++){
  let hi=true,lo=true;for(let k=1;k<=depth;k++){if(d[i].high<=d[i-k].high||d[i].high<d[i+k].high)hi=false;if(d[i].low>=d[i-k].low||d[i].low>d[i+k].low)lo=false;}
  if(!hi&&!lo)continue;const prior=d.slice(Math.max(0,i-20),i).map(c=>Math.max(0,c.high-c.low)).sort((a,b)=>a-b),median=prior[Math.floor(prior.length/2)]||0,minMove=Math.max(median*deviation/10,Math.abs(d[i].close)*1e-8,1e-10);
  if(hi)found.push({i,time:d[i].time,price:d[i].high,type:"high",confirmedAt:i+depth,minMove});if(lo)found.push({i,time:d[i].time,price:d[i].low,type:"low",confirmedAt:i+depth,minMove});
 }
 found.sort((a,b)=>a.i-b.i||(a.type==="high"?-1:1));const stable=[];
 for(const p of found){const last=stable.at(-1);if(last&&last.type===p.type&&p.i-last.i<=backstep)continue;const opposite=[...stable].reverse().find(q=>q.type!==p.type);if(opposite&&Math.abs(p.price-opposite.price)<Math.max(p.minMove,opposite.minMove))continue;stable.push(p);}
 return{highs:stable.filter(p=>p.type==="high"),lows:stable.filter(p=>p.type==="low"),zigzag:stable,settings:{depth,deviation,backstep,confirmedRightBars:depth,immutableConfirmedPivots:true}};
}
function findDiagonalStructure(source,seconds,tf){
 if(!Array.isArray(source)||source.length<30)return null;
 const d=source.slice().sort((a,b)=>a.time-b.time),p=structurePivots(d,3,3,3),ranges=d.slice(-20).map(c=>c.high-c.low).sort((a,b)=>a-b),median=ranges[Math.floor(ranges.length/2)]||Math.abs(d.at(-1).close)*1e-7;
 const decimals=Math.max(0,...d.slice(-20).map(c=>{const s=String(c.close);return s.includes(".")?s.split(".")[1].length:0;})),tick=Math.pow(10,-Math.min(10,decimals)),tol=Math.max(2*tick,median*.10,Math.abs(d.at(-1).close)*1e-10),gap=6;
 const find=(side,pts,opps,sign)=>{let best=null;const points=pts.slice(-36),other=opps.slice(-120);
  for(let a=0;a<points.length-1;a++)for(let b=a+1;b<points.length;b++){const p1=points[a],p2=points[b],dx=p2.i-p1.i;if(dx<gap)continue;const slope=(p2.price-p1.price)/dx;if(Math.sign(slope)!==sign||Math.abs(p2.price-p1.price)<median*.15)continue;const base=i=>p1.price+slope*(i-p1.i),touches=[];let last=-Infinity,left=true;
   for(let k=p1.i;k<d.length;k++){const c=d[k],line=base(k),prev=d[k-1],prevLine=k?base(k-1):line;if(k>last&&prev&&(side==="BUY"?prev.close>prevLine+tol*2:prev.close<prevLine-tol*2))left=true;const wick=side==="BUY"?c.low<=line+tol&&c.high>=line-tol:c.high>=line-tol&&c.low<=line+tol,away=side==="BUY"?c.close>line+tol*.15:c.close<line-tol*.15;if(wick&&away&&left&&k-last>=gap){touches.push({i:k,time:c.time,price:side==="BUY"?c.low:c.high});last=k;left=false;}}
   if(touches.length<2)continue;const initialOpposite=other.filter(q=>q.i>=p1.i).sort((a,b)=>a.i-b.i).slice(0,8),offsets=initialOpposite.map(q=>q.price-base(q.i)).filter(v=>side==="BUY"?v>tol*2:v< -tol*2);if(offsets.length<2)continue;offsets.sort((x,y)=>x-y);const offset=offsets[Math.floor(offsets.length/2)];if(Math.abs(offset)<tol*3)continue;
   const oppositeTouches=[];let lastOpp=-Infinity;for(const q of other.filter(q=>q.i>=p1.i).sort((x,y)=>x.i-y.i)){if(Math.abs(q.price-(base(q.i)+offset))<=tol*2&&q.i-lastOpp>=gap){oppositeTouches.push(q);lastOpp=q.i;}}if(oppositeTouches.length<2)continue;
   let broken=false;for(let k=p2.i+1;k<d.length;k++){const low=base(k),high=low+offset;if(d[k].close<Math.min(low,high)-tol||d[k].close>Math.max(low,high)+tol){broken=true;break;}}if(broken)continue;
   const age=d.length-1-touches.at(-1).i;if(age>90)continue;const score=touches.length*100+oppositeTouches.length*15-age*.25;if(!best||score>best.score)best={side,p1,p2,slope,offset,touches,oppositeTouches,score,third:touches[2]||null};
  }return best;};
 const b=find("BUY",p.lows,p.highs,1),s=find("SELL",p.highs,p.lows,-1),v=[b,s].filter(Boolean).sort((x,y)=>y.score-x.score)[0];if(!v)return null;
 const base=i=>v.p1.price+v.slope*(i-v.p1.i),upper=i=>base(i)+v.offset,first=v.touches[0];
 const line1={time1:d[v.p1.i].time,time2:d[v.p2.i].time,price1:v.p1.price,price2:v.p2.price,touches:v.touches.slice(0,3).map((t,i)=>({time:t.time,price:t.price,n:i+1}))},line2={time1:d[v.p1.i].time,time2:d[v.p2.i].time,price1:v.p1.price+v.offset,price2:v.p2.price+v.offset,touches:v.oppositeTouches.slice(0,3).map(t=>({time:t.time,price:t.price}))};
 return{side:v.side,tf,seconds,d,first,second:v.touches[1],third:v.third,firstStop:first.price,touches:v.touches,line1,line2,projectTime:d.at(-1).time+seconds,projectPrice1:base(d.length),projectPrice2:upper(d.length),tolerance:tol,zigzagSettings:"3/3/3",oppositeTouches:v.oppositeTouches};
}
function buildStructuralPlan(baseCandles,displayTf,ctx=null){
 const tf=Number(displayTf)||60,baseSeconds=Number(ctx?.baseSeconds)||60,closedAt=(Number(baseCandles.at(-1)?.time)||0)+baseSeconds,closed=(rows,sec)=>(rows||[]).filter(c=>c.time+sec<=closedAt),aggregate=sec=>candlesAtTf(baseCandles,sec).filter(c=>c.time+sec<=closedAt);
 const history=(sec,key)=>Array.isArray(ctx?.[key])&&ctx[key].length?ctx[key]:(sec===60?baseCandles:(typeof getHigherTimeframeHistory==="function"?getHigherTimeframeHistory(sec):aggregate(sec)));
 const h4=closed(history(14400,"h4"),14400),m30=closed(history(1800,"m30"),1800),h1=closed(history(3600,"h1"),3600),d1=closed(history(86400,"d1"),86400),active=closed(Array.isArray(ctx?.active)?ctx.active:history(tf,"active"),tf),label=tf>=3600?"H"+tf/3600:"M"+tf/60,candidate=findDiagonalStructure(active,tf,label),lines=[],items=[];
 if(candidate){[candidate.line1,candidate.line2].forEach((l,n)=>lines.push({...l,side:candidate.side,primary:n===0,label:n===0?label+" · "+(candidate.side==="BUY"?"SOPORTE":"RESISTENCIA"):"",touches:n===0?candidate.touches.slice(0,3).map((t,i)=>({time:t.time,price:t.price,n:i+1})):[],projectTime:candidate.projectTime}));}
 const dir=candidate?.side||null,target=closed(history(600,"target"),600),tpPiv=target.length>=9?structurePivots(target,3,3,3):{highs:[],lows:[]},localPiv=candidate?structurePivots(active,3,3,3):{highs:[],lows:[]};
 const getTp2=(side,price)=>{let a=(side==="BUY"?tpPiv.highs:tpPiv.lows).map(p=>({price:p.price,time:target[p.i]?.time,kind:"PIVOTE M10"})).filter(p=>side==="BUY"?p.price>price:p.price<price).sort((x,y)=>side==="BUY"?x.price-y.price:y.price-x.price);if(!a.length)a=(side==="BUY"?localPiv.highs:localPiv.lows).map(p=>({price:p.price,time:active[p.i]?.time,kind:"PIVOTE "+label})).filter(p=>side==="BUY"?p.price>price:p.price<price).sort((x,y)=>side==="BUY"?x.price-y.price:y.price-x.price);return a[0]||null;};
 let thirdTouch=null,rejection=null,confirmation=null,projection=null,signal=null,tp1=null,tp2=null,sl=null,validLevels=false,confirmed=false;
 if(candidate?.third){thirdTouch=candidate.third;const d=candidate.d,idx=thirdTouch.i,rej=d[idx],follow=d.slice(idx+1,idx+4),slope=(candidate.line1.price2-candidate.line1.price1)/Math.max(1,candidate.line1.time2-candidate.line1.time1),lineAt=t=>candidate.line1.price1+slope*(t-candidate.line1.time1),oppSlope=(candidate.line2.price2-candidate.line2.price1)/Math.max(1,candidate.line2.time2-candidate.line2.time1),oppAt=t=>candidate.line2.price1+oppSlope*(t-candidate.line2.time1),touchPrice=lineAt(thirdTouch.time),range=Math.max(1e-12,rej.high-rej.low),body=Math.abs(rej.close-rej.open),lw=Math.min(rej.open,rej.close)-rej.low,uw=rej.high-Math.max(rej.open,rej.close),doji=isDoji(rej);
  const rejected=dir==="BUY"?(doji||rej.close<rej.open)&&lw>=Math.max(body*.2,range*.12)&&rej.close>=touchPrice-candidate.tolerance*.15:(doji||rej.close>rej.open)&&uw>=Math.max(body*.2,range*.12)&&rej.close<=touchPrice+candidate.tolerance*.15;if(rejected)rejection=rej;
  const three=follow.length===3&&follow.every(c=>dir==="BUY"?c.close>c.open:c.close<c.open),exact=active.length-1===idx+3;if(rejected&&three&&exact)confirmation=follow[2];
  const entryTime=confirmation?.time??d[Math.min(d.length-1,idx+3)]?.time??thirdTouch.time,entry=confirmation?.close??d[Math.min(d.length-1,idx+3)]?.close??touchPrice,tp1Price=oppAt(entryTime);tp1={price:tp1Price,kind:"LÍNEA OPUESTA"};tp2=getTp2(dir,tp1Price);const margin=candidate.tolerance*.25;sl=dir==="BUY"?candidate.first.price-margin:candidate.first.price+margin;
  validLevels=!!tp2&&Number.isFinite(entry)&&Number.isFinite(sl)&&(dir==="BUY"?sl<entry&&tp1Price>entry&&tp2.price>tp1Price:sl>entry&&tp1Price<entry&&tp2.price<tp1Price);confirmed=!!rejection&&!!confirmation&&validLevels;
  const low=touchPrice-candidate.tolerance,high=touchPrice+candidate.tolerance;projection={direction:dir==="BUY"?"COMPRAR":"VENDER",zoneLow:low,zoneHigh:high,low,high,entry,sl,tp1:tp1Price,tp2:tp2?.price,projectTime:thirdTouch.time,stage:!rejection?"T3 · ESPERANDO RECHAZO":!three?"ESPERANDO 3 VELAS A FAVOR":!exact?"CONFIRMACIÓN CERRADA":!validLevels?"NIVELES NO VÁLIDOS":confirmed?"SEÑAL CONFIRMADA":"ESPERANDO",timeframe:label,confirmed,reason:"Rechazo en tercer toque + 3 velas cerradas a favor"};
  if(confirmed)signal={direction:dir==="BUY"?"COMPRAR":"VENDER",entry,sl,tp1:tp1Price,tp2:tp2.price,time:confirmation.time+candidate.seconds,touchTime:thirdTouch.time,touchIndex:idx,timeframe:label,mode:"CANAL 3 TOQUES + RECHAZO + 3 VELAS"};
  if(confirmed)items.push({type:"signal",price:thirdTouch.price,label:signal.direction,side:signal.direction,time:thirdTouch.time});
 }
 const h4Obs=[...detectOrderBlocks(h4,"BUY"),...detectOrderBlocks(h4,"SELL")].sort((a,b)=>a.time-b.time),m30Obs=[...detectOrderBlocks(m30,"BUY"),...detectOrderBlocks(m30,"SELL")].sort((a,b)=>a.time-b.time),bias4=h4Obs.at(-1)?.side||null,bias30=m30Obs.at(-1)?.side||null,biasD1=latestObBias(d1);
 const addOb=(o,label,tfSec)=>items.push({type:"ob",price:o.low,label,side:o.side,time:o.time,active:o.side===bias4,tf:tfSec},{type:"ob",price:o.high,label:"",side:o.side,time:o.time,active:o.side===bias4,tf:tfSec});
 h4Obs.slice(-2).forEach(o=>addOb(o,"ZONA H4",14400));m30Obs.slice(-2).forEach(o=>addOb(o,"OB M30",1800));
 const localObs=[...detectOrderBlocks(active,"BUY"),...detectOrderBlocks(active,"SELL")].sort((a,b)=>a.time-b.time);localObs.slice(-2).forEach(o=>addOb(o,"OB "+label,tf));
 const recommendation=!bias4?"H4 SIN SESGO":!dir?"INFORMATIVO":bias4===dir?"H4 A FAVOR":"H4 EN CONTRA · NO BLOQUEA",status=!candidate?"BUSCANDO CANAL "+label:!thirdTouch?"TOQUES "+candidate.touches.length+"/3":!rejection?"T3 · ESPERANDO RECHAZO":!confirmation?"RECHAZO · ESPERANDO 3 VELAS":!validLevels?"TP/SL NO VÁLIDOS":dir==="BUY"?"COMPRA CONFIRMADA":"VENTA CONFIRMADA";
 return{lines,items,projection,status,confirmed,bias4,bias30,biasD1,candidate,thirdTouch,near:localObs,last:baseCandles.at(-1),signal,targetTf:tp2?.kind||"M10 / ESTRUCTURA",recommendation,rejection,confirmation,activeTf:tf,activeSource:active};
}
function runStructuralBacktest(symbol,market,candles,displayTf){
 if(!Array.isArray(candles)||candles.length<120)return[];const sec=Number(displayTf)||60,d=candles.slice().sort((a,b)=>a.time-b.time),from=90,trades=[],seen=new Set();
 for(let i=from;i<d.length;i++){const prefix=d.slice(0,i+1),cutoff=prefix.at(-1).time+sec,before=t=>((higherTfBuffers&&higherTfBuffers[t])||[]).filter(c=>c.time+t<=cutoff),plan=buildStructuralPlan(prefix,sec,{active:prefix,baseSeconds:sec,h4:before(14400),m30:before(1800),h1:before(3600),d1:before(86400),target:before(600)});
  if(!plan.signal||!plan.candidate)continue;const s=plan.signal,c=plan.candidate,key=[sec,c.side,c.line1.time1,c.line1.time2,c.line1.price1,c.line1.price2].join(":");if(seen.has(key))continue;seen.add(key);let result="ABIERTA",price=s.entry,exitTime=null,exitReason="SIN CIERRE";
  for(let j=i+1;j<d.length;j++){const bar=d[j],stop=s.direction==="COMPRAR"?bar.low<=s.sl:bar.high>=s.sl,one=s.direction==="COMPRAR"?bar.high>=s.tp1:bar.low<=s.tp1,two=s.direction==="COMPRAR"?bar.high>=s.tp2:bar.low<=s.tp2;if(stop){result="PERDIDA";price=s.sl;exitTime=bar.time*1000;exitReason="SL";break;}if(two){result="GANADA";price=s.tp2;exitTime=bar.time*1000;exitReason="TP2";break;}if(one){result="GANADA";price=s.tp1;exitTime=bar.time*1000;exitReason="TP1";break;}}
  trades.push({...s,id:"BT-"+symbol+"-"+s.time,symbol,market,price,entryTime:s.time*1000,exitTime,result,exitReason,structureKey:key});
 }
 backtestTrades.splice(0,backtestTrades.length,...trades);setBacktestTrades(trades);backtestSymbol=symbol;backtestReady=true;structuralBacktestValidatedKey=symbol+":"+sec;if(typeof updateDailyPanel==="function")updateDailyPanel();setText("chart-message","BACKTEST "+(sec>=3600?"H"+sec/3600:"M"+sec/60)+" · "+d.length+" velas revisadas · "+trades.length+" señales.");return trades;
}
function analyzeCandles(symbol,market,candles){
 if(!Array.isArray(candles)||candles.length<100)return;const d=candles.slice().sort((a,b)=>a.time-b.time),i=d.length-2;if(i<65)return;const closed=d[i],tf=Number(document.getElementById("timeframe")?.value)||60,plan=buildStructuralPlan(d.slice(0,i+1),tf);
 if(typeof evaluateOpenOperations==="function")evaluateOpenOperations(symbol,closed);if(typeof evaluateStrategyJournal==="function")evaluateStrategyJournal(symbol,closed);
 lastProjection=plan.projection;setText("side-analysis-status","● "+plan.status);setText("structure-diagnostic","ESTRUCTURA "+(plan.candidate?.tf||"M"+tf/60)+" · "+plan.status+" · "+plan.recommendation+" · "+(plan.activeSource?.length||0)+" VELAS · PIVOTE 3/3");
 setText("trend-h4",plan.bias4==="BUY"?"ZONA COMPRA":plan.bias4==="SELL"?"ZONA VENTA":"SIN ZONA H4");setText("confirm-m30",plan.recommendation||"INFORMATIVO");setText("confirm-m1",plan.rejection?"RECHAZO DETECTADO":plan.thirdTouch?"ESPERANDO 3 VELAS A FAVOR":"ESPERANDO 3 TOQUES");setText("touch-status",plan.thirdTouch?"3º TOQUE":(plan.candidate?.touches?.length||0)+"/3 TOQUES");setText("ob-status",plan.bias4||"BUSCANDO");setText("channel-status",plan.candidate?.side==="BUY"?"ALCISTA":plan.candidate?.side==="SELL"?"BAJISTA":"BUSCANDO");
 if(typeof renderProjection==="function")renderProjection(plan);
 const active=plan.activeSource?.at(-1),btKey=symbol+":"+tf;if(structuralBacktestValidatedKey!==btKey&&plan.activeSource?.length>=120){structuralBacktestKey=btKey;runStructuralBacktest(symbol,market,plan.activeSource,tf);}
 if(typeof setStructureOverlay==="function")setStructureOverlay({items:plan.items,lines:plan.lines,projection:plan.projection,activeTf:tf});
 if(plan.projection&&typeof drawTradeLevels==="function")drawTradeLevels({entry:plan.projection.entry,sl:plan.projection.sl,tp1:plan.projection.tp1,tp2:plan.projection.tp2,time:plan.projection.projectTime,direction:plan.projection.direction},false);else if(typeof clearTradeLevels==="function")clearTradeLevels();
 if(plan.signal&&plan.candidate&&structuralBacktestValidatedKey===symbol+":"+tf){const c=plan.candidate,key=[tf,c.side,c.line1.time1,c.line1.time2,Number(c.line1.price1).toPrecision(12),Number(c.line1.price2).toPrecision(12)].join(":");if(!usedStructureKeys.has(symbol+":"+key)&&!strategyJournal.some(t=>t.structureKey===symbol+":"+key)){const full={...plan.signal,symbol,market,structureKey:symbol+":"+key};addSignal(full);recordStrategyTrade(full);notifyBot("BOTDER · "+plan.signal.direction,"Tercer toque y tres velas a favor confirmados.");}}
 if(typeof drawRsiPanel==="function")drawRsiPanel(makeIndicators(d).rsi,d);
}
function recordStrategyTrade(signal){
 if(!signal||strategyJournal.some(t=>t.symbol===signal.symbol&&t.structureKey===signal.structureKey))return;
 strategyJournal.unshift({id:"STR-"+Date.now().toString(36).toUpperCase(),symbol:signal.symbol,market:signal.market,direction:signal.direction,entry:Number(signal.entry),sl:Number(signal.sl),tp1:Number(signal.tp1),tp2:Number(signal.tp2),timeframe:signal.timeframe||"",structureKey:signal.structureKey,touchTime:Number(signal.touchTime||signal.time)*1000,entryTime:Number(signal.time)*1000,result:"ABIERTA"});
 strategyJournal=strategyJournal.slice(0,2000);saveStrategyJournal();renderStrategyJournal();
}
function renderStrategyJournal(){
 const closed=strategyJournal.filter(t=>t.result==="GANADA"||t.result==="PERDIDA"),wins=closed.filter(t=>t.result==="GANADA").length;
 setText("bt-wins",wins);setText("bt-losses",closed.length-wins);setText("bt-rate",closed.length?(wins/closed.length*100).toFixed(1)+"%":"0%");setText("bt-total",strategyJournal.length);setText("bt-open",strategyJournal.filter(t=>t.result==="ABIERTA").length);
 const area=document.getElementById("history");if(!area)return;const safe=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 if(typeof setChartBacktestTrades==="function")setChartBacktestTrades([...(backtestTradeData||[]),...strategyJournal.map(t=>({...t,tp1:t.tp1,tp2:t.tp2,price:t.exitPrice,exitTime:t.exitTime||Date.now()}))]);
 area.innerHTML=strategyJournal.length?strategyJournal.map(t=>'<article class="history-row"><div><strong>'+safe(t.market||t.symbol)+' · '+safe(t.direction)+' · '+safe(t.timeframe)+'</strong><small>'+new Date(t.entryTime).toLocaleString("es-PA",{dateStyle:"short",timeStyle:"short"})+' · T3 '+new Date(t.touchTime||t.entryTime).toLocaleTimeString("es-PA",{hour:"2-digit",minute:"2-digit"})+' · ENTRADA '+fmt(t.entry)+' · SL '+fmt(t.sl)+' · TP1 '+fmt(t.tp1)+' · TP2 '+fmt(t.tp2)+(t.exitPrice!=null?' · SALIDA '+fmt(t.exitPrice):'')+(t.exitReason?' · '+safe(t.exitReason):'')+'</small></div><span class="history-result '+t.result+'">'+(t.result==="ABIERTA"?"EN CURSO":t.result)+'</span></article>').join(""):'<div class="empty-state">Aún no hay señales confirmadas registradas.</div>';
}

if(typeof renderStrategyJournal==="function")renderStrategyJournal();


function recordStrategyTrade(signal){
 if(!signal||strategyJournal.some(t=>t.symbol===signal.symbol&&t.structureKey===signal.structureKey))return;
 strategyJournal.unshift({id:"STR-"+Date.now().toString(36).toUpperCase(),symbol:signal.symbol,market:signal.market,direction:signal.direction,entry:Number(signal.entry),sl:Number(signal.sl),tp1:Number(signal.tp1),tp2:Number(signal.tp2),timeframe:signal.timeframe||"",structureKey:signal.structureKey,touchTime:Number(signal.touchTime||signal.time)*1000,entryTime:Number(signal.time)*1000,entered:false,result:"PENDIENTE"});
 strategyJournal=strategyJournal.slice(0,2000);saveStrategyJournal();renderStrategyJournal();
}
function markEntered(id){
 const s=signals.find(x=>x.id===id);if(!s||s.status!=="ACTIVE")return;s.status="ENTERED";
 operations.unshift({...s,enteredAt:Date.now(),currentPrice:Number(s.entry),result:"OPEN"});
 const j=strategyJournal.find(t=>t.structureKey===s.structureKey);if(j){j.entered=true;j.enteredAt=Date.now();j.result="ABIERTA";saveStrategyJournal();}
 renderSignals();renderOperations();renderStrategyJournal();
}
function markIgnored(id){
 const s=signals.find(x=>x.id===id);if(!s||s.status!=="ACTIVE")return;s.status="IGNORED";
 const j=strategyJournal.find(t=>t.structureKey===s.structureKey);if(j){j.entered=false;j.result="NO ENTRÉ";j.exitReason="SEÑAL DESCARTADA";j.exitTime=Date.now();saveStrategyJournal();}
 history.unshift({...s,result:"NO ENTRÉ",finishedAt:Date.now()});renderSignals();renderHistory();renderStrategyJournal();
}
function evaluateStrategyJournal(symbol,candle){
 if(!candle)return;let changed=false;
 strategyJournal.forEach(t=>{if(t.symbol!==symbol||t.entered!==true||t.result!=="ABIERTA"||candle.time*1000<t.entryTime)return;
  const hit1=t.direction==="COMPRAR"?candle.high>=t.tp1:candle.low<=t.tp1,hit2=t.direction==="COMPRAR"?candle.high>=t.tp2:candle.low<=t.tp2,stop=t.direction==="COMPRAR"?candle.low<=t.sl:candle.high>=t.sl;
  if(!t.tp1Hit&&stop){t.result="PERDIDA";t.exitPrice=t.sl;t.exitReason="SL";t.exitTime=candle.time*1000;changed=true;return;}
  if(!t.tp1Hit&&hit1){t.tp1Hit=true;t.tp1Time=candle.time*1000;changed=true;}
  if(t.tp1Hit&&hit2){t.result="GANADA";t.exitPrice=t.tp2;t.exitReason="TP2";t.exitTime=candle.time*1000;changed=true;}
  else if(t.tp1Hit&&stop){t.result="GANADA";t.exitPrice=t.sl;t.exitReason="TP1 COBRADO · RESTO EN SL";t.exitTime=candle.time*1000;changed=true;}
 });
 if(changed){saveStrategyJournal();renderStrategyJournal();}
}
function renderStrategyJournal(){
 const entered=strategyJournal.filter(t=>t.entered===true),closed=entered.filter(t=>t.result==="GANADA"||t.result==="PERDIDA"),wins=closed.filter(t=>t.result==="GANADA").length;
 setText("bt-wins",wins);setText("bt-losses",closed.length-wins);setText("bt-rate",closed.length?(wins/closed.length*100).toFixed(1)+"%":"0%");setText("bt-total",entered.length);setText("bt-open",entered.filter(t=>t.result==="ABIERTA").length);
 const area=document.getElementById("history");if(!area)return;const safe=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 if(typeof setChartBacktestTrades==="function")setChartBacktestTrades([...(backtestTradeData||[]),...strategyJournal.map(t=>({...t,tp1:t.tp1,tp2:t.tp2,price:t.exitPrice,exitTime:t.exitTime||Date.now()}))]);
 area.innerHTML=strategyJournal.length?strategyJournal.map(t=>{const status=t.result==="PENDIENTE"?"SEÑAL · SIN DECISIÓN":t.result==="NO ENTRÉ"?"NO ENTRÉ":t.result==="ABIERTA"?"EN CURSO":t.result;return '<article class="history-row"><div><strong>'+safe(t.market||t.symbol)+' · '+safe(t.direction)+' · '+safe(t.timeframe)+'</strong><small>'+new Date(t.entryTime).toLocaleString("es-PA",{dateStyle:"short",timeStyle:"short"})+' · T3 '+new Date(t.touchTime||t.entryTime).toLocaleTimeString("es-PA",{hour:"2-digit",minute:"2-digit"})+' · ENTRADA '+fmt(t.entry)+' · SL '+fmt(t.sl)+' · TP1 '+fmt(t.tp1)+' · TP2 '+fmt(t.tp2)+(t.exitPrice!=null?' · SALIDA '+fmt(t.exitPrice):'')+(t.exitReason?' · '+safe(t.exitReason):'')+'</small></div><span class="history-result '+(t.result||"ABIERTA")+'">'+status+'</span></article>';}).join(""):'<div class="empty-state">Aún no hay señales registradas.</div>';
}
if(typeof renderStrategyJournal==="function")renderStrategyJournal();

if(typeof operations!=="undefined"&&typeof strategyJournal!=="undefined"){
 const restored=strategyJournal.filter(t=>t.entered===true&&t.result==="ABIERTA").map(t=>({...t,id:t.id,enteredAt:t.enteredAt||t.entryTime,currentPrice:Number(t.entry),result:"OPEN"}));
 operations.splice(0,operations.length,...restored);if(typeof renderOperations==="function")renderOperations();
}

function renderProjection(plan){
 const el=document.getElementById("projection-card"),status=document.getElementById("projection-status");if(!el)return;
 if(!plan?.projection){el.className="projection-empty";el.textContent=(plan?.status||"BUSCANDO ESTRUCTURA")+" · Esperando un canal válido.";if(status)status.textContent=plan?.status||"ANALIZANDO";return;}
 const p=plan.projection,buy=p.direction==="COMPRAR",price=v=>Number.isFinite(Number(v))?Number(v).toPrecision(8).replace(/0+$/,"").replace(/\.$/,""):"—";
 el.className="projection-card"+(buy?"":" projection-sell");
 el.innerHTML='<div class="projection-stage '+(buy?"":"sell")+'">'+(buy?"COMPRA · CANAL ALCISTA":"VENTA · CANAL BAJISTA")+'</div><div class="projection-meta">'+p.stage+' · TERCER TOQUE '+p.timeframe+' · TP2 '+(p.targetTf||"ESTRUCTURAL")+'</div><div class="projection-levels"><div class="projection-level"><span>ENTRADA</span><strong>'+price(p.entry)+'</strong></div><div class="projection-level"><span>SL · T1 + MARGEN</span><strong>'+price(p.sl)+'</strong></div><div class="projection-level"><span>TP1 · LÍNEA OPUESTA</span><strong>'+price(p.tp1)+'</strong></div><div class="projection-level"><span>TP2 · PIVOTE</span><strong>'+price(p.tp2)+'</strong></div></div><div class="projection-meta">Confirmación: rechazo en T3 y tres velas cerradas consecutivas a favor.<br><b>CONTEXTO H4:</b> '+(plan.recommendation||"SOLO INFORMATIVO")+' · no bloquea la señal.</div>';
 if(status)status.textContent=p.stage;
}

function renderSignals(){
 const active=signals.filter(s=>s.status==="ACTIVE");setText("signal-count",active.length);
 const safe=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 const price=v=>Number.isFinite(Number(v))?fmt(v):"—";
 const markup=active.length?active.map(s=>'<article class="signal-card"><div class="muted">'+safe(s.id)+' · '+safe(s.market)+'</div><h3 class="'+(s.direction==="COMPRAR"?"buy":"sell")+'">'+safe(s.direction)+'</h3><div class="levels"><div class="level"><span>ENTRADA</span><strong>'+price(s.entry)+'</strong></div><div class="level"><span>SL · T1</span><strong>'+price(s.sl)+'</strong></div><div class="level"><span>TP1</span><strong>'+price(s.tp1)+'</strong></div><div class="level"><span>TP2</span><strong>'+price(s.tp2)+'</strong></div></div><div class="muted">'+safe(s.mode||"Canal de tres toques")+' · '+safe(s.timeframe||"")+'</div><div class="action-row"><button class="enter-button" onclick="markEntered(\''+safe(s.id)+'\')">ENTRÉ</button><button class="ignore-button" onclick="markIgnored(\''+safe(s.id)+'\')">NO ENTRÉ</button></div></article>').join(""):'<div class="empty-state">Todavía no hay señales confirmadas.</div>';
 ["signals-top","signals-sidebar","signals"].forEach(id=>{const area=document.getElementById(id);if(area)area.innerHTML=markup;});
}
