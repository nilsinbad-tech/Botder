let candleData=[],chartSymbol=null,tradeLevels=[],signalMarker=null,chartCanvas=null,chartContext=null,resizeObserver=null,candleStyle="normal";
let backtestTradeData=[];let structureOverlay={items:[],projection:null};
let viewEnd=0,viewCount=100,followLive=true,dragX=null,dragEnd=0,activePointers=new Map(),pinchStart=0,pinchCount=100,pinchAnchorIndex=0,pinchAnchorRatio=.5,chartFrame=null,scaleMin=null,scaleMax=null,scaleWindow="",chartGranularity=60;let lastPanDelta=0,lastPanAt=0,panMomentumFrame=null;const futureSpace=25;let drawingMode="pan",userDrawings=[],pendingDrawing=null,priceScaleDrag=null,verticalPanDrag=null,chartPlot={left:10,right:66,top:16,bottom:25,step:1,start:0};
function createMarketChart(containerId="chart-area"){
 const host=document.getElementById(containerId);if(!host)return false;
 // Evita crear un segundo canvas sobre el primero: app.js y este archivo podían inicializar el mismo gráfico.
 if(chartCanvas&&chartCanvas.isConnected&&chartCanvas.parentElement===host&&chartContext)return true;
 host.innerHTML="";chartCanvas=document.createElement("canvas");
 chartCanvas.style.cssText="position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;cursor:grab";
 host.appendChild(chartCanvas);const tools=document.createElement("div");tools.style.cssText="position:absolute;z-index:5;top:8px;left:8px;display:flex;gap:5px";[["pan","MOVER"],["line","LÍNEA"],["zone","ZONA"],["clear","BORRAR"]].forEach(([mode,label])=>{const b=document.createElement("button");b.type="button";b.textContent=label;b.style.cssText="border:1px solid #48617e;border-radius:6px;background:#101d2d;color:#e8f0fa;padding:6px 9px;font-size:10px;font-weight:700";b.addEventListener("click",()=>{if(mode==="clear"){userDrawings=[];pendingDrawing=null;}else drawingMode=mode;tools.querySelectorAll("button").forEach(x=>x.style.background=x===b?"#245b78":"#101d2d");drawMarketChart();});tools.appendChild(b);});[["zoom-in","+"],["zoom-out","−"],["reset-view","AJUSTAR"]].forEach(([action,label])=>{const b=document.createElement("button");b.type="button";b.textContent=label;b.title=action==="zoom-in"?"Acercar":action==="zoom-out"?"Alejar":"Volver a vista actual";b.style.cssText="border:1px solid #48617e;border-radius:6px;background:#101d2d;color:#e8f0fa;padding:6px 9px;font-size:10px;font-weight:700";b.addEventListener("click",()=>{if(action==="reset-view"){viewCount=100;viewEnd=candleData.length+futureSpace;followLive=true;scaleMin=null;scaleMax=null;scaleWindow="";}else{const ratio=.5,end=Math.max(0,Math.min(candleData.length+viewCount-1,viewEnd||candleData.length+futureSpace)),start=Math.max(0,end-viewCount),anchor=start+ratio*viewCount;viewCount=Math.max(15,Math.min(5000,Math.round(viewCount*(action==="zoom-in"?.75:1.33))));viewEnd=Math.max(Math.min(viewCount,candleData.length),Math.min(candleData.length+viewCount-1,Math.round(anchor+(1-ratio)*viewCount)));followLive=false;}drawMarketChart();});tools.appendChild(b);});host.appendChild(tools);
 chartContext=chartCanvas.getContext("2d");if(!chartContext)return false;
 if(resizeObserver)resizeObserver.disconnect();resizeObserver=new ResizeObserver(resizeMarketChart);resizeObserver.observe(host);
 chartCanvas.addEventListener("pointerdown",e=>{
  if(e.pointerType==="mouse"&&e.button!==0)return;
  activePointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
  try{chartCanvas.setPointerCapture(e.pointerId);}catch(_){}
  if(activePointers.size===1&&candleData.length===0){dragX=null;return;}
  if(activePointers.size===1){
   const rect=chartCanvas.getBoundingClientRect();
   if(e.clientX-rect.left>=rect.width-66&&Number.isFinite(scaleMin)&&Number.isFinite(scaleMax)){
    priceScaleDrag={y:e.clientY,min:scaleMin,max:scaleMax};dragX=null;chartCanvas.style.cursor="ns-resize";return;
   }
   if(drawingMode==="line"||drawingMode==="zone"){const p=chartPoint(e);if(p){if(drawingMode==="line")userDrawings.push({type:"line",price:p.price});else pendingDrawing={type:"zone",x1:p.index,x2:p.index,p1:p.price,p2:p.price};}drawMarketChart();return;}
   followLive=false;
   verticalPanDrag={y:e.clientY,min:scaleMin,max:scaleMax};
   dragX=e.clientX;
   dragEnd=Math.max(Math.min(viewCount,candleData.length),Math.min(candleData.length+viewCount-1,viewEnd||candleData.length+futureSpace));
   viewEnd=dragEnd;
   chartCanvas.style.cursor="grabbing";
  }else if(activePointers.size===2){
   const p=[...activePointers.values()];
   pinchStart=Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y);
   pinchCount=viewCount;
   const rect=chartCanvas.getBoundingClientRect(),mid=(p[0].x+p[1].x)/2;
   pinchAnchorRatio=Math.max(0,Math.min(1,(mid-rect.left-10)/Math.max(1,rect.width-76)));
   const end=Math.max(0,Math.min(candleData.length+viewCount-1,viewEnd||candleData.length+futureSpace));
   const start=Math.max(0,end-viewCount);
   pinchAnchorIndex=start+pinchAnchorRatio*viewCount;
   dragX=null;
  }
 });
 chartCanvas.addEventListener("pointermove",e=>{
  if(!activePointers.has(e.pointerId))return;
  if(pendingDrawing){const p=chartPoint(e);if(p){pendingDrawing.x2=p.index;pendingDrawing.p2=p.price;drawMarketChart();}return;}
  const previous=activePointers.get(e.pointerId);
  activePointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(priceScaleDrag){const height=Math.max(1,chartCanvas.parentElement.clientHeight-41),factor=Math.exp((e.clientY-priceScaleDrag.y)/height*2.2),mid=(priceScaleDrag.min+priceScaleDrag.max)/2,half=(priceScaleDrag.max-priceScaleDrag.min)*factor/2;scaleMin=mid-half;scaleMax=mid+half;scaleWindow="manual-price-scale";drawMarketChart();return;}
  if(verticalPanDrag&&activePointers.size===1){const plotHeight=Math.max(1,chartCanvas.parentElement.clientHeight-chartPlot.top-chartPlot.bottom),shift=(verticalPanDrag.y-e.clientY)/plotHeight*(verticalPanDrag.max-verticalPanDrag.min);scaleMin=verticalPanDrag.min+shift;scaleMax=verticalPanDrag.max+shift;scaleWindow="manual-pan:"+windowKey;drawMarketChart();}
  if(activePointers.size>=2){
   const p=[...activePointers.values()],dist=Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y);
   if(pinchStart>0){
    viewCount=Math.max(15,Math.min(5000,Math.round(pinchCount*pinchStart/Math.max(1,dist))));
    const nextEnd=pinchAnchorIndex+(1-pinchAnchorRatio)*viewCount;
    viewEnd=Math.max(Math.min(viewCount,candleData.length),Math.min(candleData.length+viewCount-1,Math.round(nextEnd)));
   }
   drawMarketChart();return;
  }
  if(dragX===null)return;
  const step=(chartCanvas.parentElement.clientWidth-76)/Math.max(1,viewCount);
  const shift=Math.round((dragX-e.clientX)/Math.max(1,step));
  const next=Math.max(Math.min(viewCount,candleData.length),Math.min(candleData.length+viewCount-1,dragEnd+shift));
  lastPanDelta=next-viewEnd;lastPanAt=performance.now();viewEnd=next;followLive=false;
  drawMarketChart();
 });
 const endDrag=e=>{
  if(pendingDrawing){if(Math.abs(pendingDrawing.x2-pendingDrawing.x1)>1&&Math.abs(pendingDrawing.p2-pendingDrawing.p1)>0)userDrawings.push(pendingDrawing);pendingDrawing=null;drawMarketChart();}
  activePointers.delete(e.pointerId);
  if(priceScaleDrag){priceScaleDrag=null;chartCanvas.style.cursor="grab";}
  if(verticalPanDrag){verticalPanDrag=null;}
  if(activePointers.size===0&&Math.abs(lastPanDelta)>=1&&performance.now()-lastPanAt<100){
   if(panMomentumFrame!==null)cancelAnimationFrame(panMomentumFrame);
   let velocity=lastPanDelta*.72;
   const coast=()=>{velocity*=.90;if(Math.abs(velocity)<.35){panMomentumFrame=null;return;}const next=Math.max(Math.min(viewCount,candleData.length),Math.min(candleData.length+viewCount-1,viewEnd+Math.round(velocity)));if(next===viewEnd){panMomentumFrame=null;return;}viewEnd=next;drawMarketChart();panMomentumFrame=requestAnimationFrame(coast);};panMomentumFrame=requestAnimationFrame(coast);
  }
  if(activePointers.size<2)pinchStart=0;
  if(activePointers.size===1){
   const p=[...activePointers.values()][0];dragX=p.x;dragEnd=viewEnd;
  }else{dragX=null;chartCanvas.style.cursor="grab";}
 };
 chartCanvas.addEventListener("pointerup",endDrag);
 chartCanvas.addEventListener("pointercancel",endDrag);
 chartCanvas.addEventListener("lostpointercapture",endDrag);
 chartCanvas.addEventListener("wheel",e=>{e.preventDefault();const rect=chartCanvas.getBoundingClientRect(),ratio=Math.max(0,Math.min(1,(e.clientX-rect.left-10)/Math.max(1,rect.width-76))),end=Math.max(0,Math.min(candleData.length+viewCount-1,viewEnd||candleData.length+futureSpace)),start=Math.max(0,end-viewCount),anchor=start+ratio*viewCount;viewCount=Math.max(15,Math.min(5000,Math.round(viewCount*(e.deltaY>0?1.2:.82))));const nextEnd=anchor+(1-ratio)*viewCount;viewEnd=Math.max(Math.min(viewCount,candleData.length),Math.min(candleData.length+viewCount-1,Math.round(nextEnd)));drawMarketChart();},{passive:false});
 resizeMarketChart();drawMarketChart();return true;
}
function chartPoint(e){if(!chartCanvas)return null;const r=chartCanvas.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top,p=chartPlot;if(x<p.left||x>r.width-p.right||y<p.top||y>r.height-p.bottom||!Number.isFinite(scaleMin)||!Number.isFinite(scaleMax))return null;return {price:scaleMax-(y-p.top)/(r.height-p.top-p.bottom)*(scaleMax-scaleMin),index:p.start+(x-p.left)/p.step-.5};}
function resizeMarketChart(){if(!chartCanvas||!chartContext)return;const host=chartCanvas.parentElement;if(!host)return;const r=host.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2);chartCanvas.width=Math.max(1,Math.floor(r.width*dpr));chartCanvas.height=Math.max(1,Math.floor(r.height*dpr));chartContext.setTransform(dpr,0,0,dpr,0,0);drawMarketChart();}
function setChartSymbol(s){chartSymbol=s;candleData=[];tradeLevels=[];signalMarker=null;followLive=true;viewEnd=0;viewCount=100;userDrawings=[];pendingDrawing=null;scaleMin=null;scaleMax=null;scaleWindow="";drawMarketChart();}
function setChartGranularity(seconds){chartGranularity=Number(seconds)||60;scaleMin=null;scaleMax=null;scaleWindow="";drawMarketChart();}
function updateCandles(c){if(!Array.isArray(c))return;const oldLength=candleData.length,wasFollowing=followLive,distanceFromEnd=Math.max(0,oldLength-viewEnd);candleData=c.filter(x=>[x.time,x.open,x.high,x.low,x.close].every(Number.isFinite)).sort((a,b)=>a.time-b.time).slice();viewEnd=wasFollowing||viewEnd<=0?candleData.length+futureSpace:Math.max(Math.min(viewCount,candleData.length),Math.min(candleData.length+viewCount-1,viewEnd));scaleMin=null;scaleMax=null;scaleWindow="";drawMarketChart();}
function addCandle(c){if(!c||![c.time,c.open,c.high,c.low,c.close].every(Number.isFinite))return;const oldLength=candleData.length,last=candleData[oldLength-1];if(last&&last.time===c.time)candleData[oldLength-1]=c;else candleData.push(c);if(followLive)viewEnd=candleData.length+futureSpace;drawMarketChart();}
function setChartBacktestTrades(trades){backtestTradeData=Array.isArray(trades)?trades.slice():[];drawMarketChart();}
function setStructureOverlay(data){const hiddenTypes=new Set(["choch","sweep"]);structureOverlay={...(data||{}),items:Array.isArray(data?.items)?data.items.filter(a=>{const type=String(a.type||"").toLowerCase(),side=String(a.side||"").toUpperCase(),label=String(a.label||"").toUpperCase();return !hiddenTypes.has(type)&&!(type==="bos"&&(side==="BEAR"||label.includes("BEAR")));}):[],projection:data?.projection||null};drawMarketChart();}
function toHeikinAshi(candles){
 let previousOpen=null,previousClose=null;
 return candles.map(c=>{
  const haClose=(c.open+c.high+c.low+c.close)/4;
  const haOpen=previousOpen===null?(c.open+c.close)/2:(previousOpen+previousClose)/2;
  const haHigh=Math.max(c.high,haOpen,haClose),haLow=Math.min(c.low,haOpen,haClose);
  previousOpen=haOpen;previousClose=haClose;
  return {...c,open:haOpen,high:haHigh,low:haLow,close:haClose};
 });
}
function drawTradeLevels(signal){if(!signal)return;tradeLevels=[{value:Number(signal.entry),label:"ENTRADA",color:"#48a8ff"},{value:Number(signal.sl),label:"SL",color:"#ff5364"},{value:Number(signal.tp1),label:"TP1",color:"#f5c451"},{value:Number(signal.tp2),label:"TP2",color:"#20c997"}].filter(x=>Number.isFinite(x.value));signalMarker=Number.isFinite(Number(signal.time))?{time:Number(signal.time),direction:signal.direction}:null;drawMarketChart();}
function clearTradeLevels(){tradeLevels=[];drawMarketChart();}
function getActiveChartSymbol(){return chartSymbol;}
function drawMarketChart(){if(chartFrame!==null)return;chartFrame=requestAnimationFrame(()=>{chartFrame=null;renderMarketChart();});}
function renderMarketChart(){
 if(!chartCanvas||!chartContext)return;const ctx=chartContext,w=chartCanvas.parentElement?.clientWidth||0,h=chartCanvas.parentElement?.clientHeight||0;if(!w||!h)return;
 ctx.clearRect(0,0,w,h);ctx.fillStyle="#111b2a";ctx.fillRect(0,0,w,h);
 const left=10,right=66,top=16,bottom=25,pw=w-left-right,ph=h-top-bottom;
 ctx.font="10px Arial";ctx.strokeStyle="#26364b";ctx.lineWidth=1;
 for(let i=0;i<=4;i++){let y=top+ph*i/4;ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(w-right,y);ctx.stroke();}
 if(!candleData.length){ctx.fillStyle="#8495aa";ctx.textAlign="center";ctx.font="12px Arial";ctx.fillText("Esperando datos reales del mercado...",w/2,h/2);return;}
 const end=Math.max(0,Math.min(candleData.length+viewCount-1,viewEnd||candleData.length+futureSpace)),start=Math.max(0,end-viewCount),raw=candleStyle==="heikin"?toHeikinAshi(candleData):candleData,data=raw.slice(start,Math.min(end,candleData.length));
 if(!data.length)return;const windowKey=start+":"+end+":"+viewCount;let lows=data.map(c=>c.low),highs=data.map(c=>c.high);const visibleStart=data[0].time,visibleEnd=data[data.length-1].time;const visibleTrades=backtestTradeData.filter(t=>{const et=Number(t.entryTime)/1000,xt=Number(t.exitTime||Date.now())/1000;return Number.isFinite(et)&&et<=visibleEnd&&xt>=visibleStart;});visibleTrades.forEach(t=>[t.entry,t.sl,t.tp1,t.tp2,t.price].forEach(v=>{v=Number(v);if(Number.isFinite(v)){lows.push(v);highs.push(v);}}));const candleMin=Math.min(...data.map(c=>c.low)),candleMax=Math.max(...data.map(c=>c.high));tradeLevels.forEach(x=>{if(Number.isFinite(x.value)){lows.push(x.value);highs.push(x.value);}});
 const scaleItems=(structureOverlay.items||[]).filter(a=>Number.isFinite(a.price)&&a.time<=visibleEnd),scaleZones=new Map();scaleItems.filter(a=>a.type==="ob"||a.type==="fvg").forEach(a=>{const k=a.type+"|"+a.time+"|"+a.side;if(!scaleZones.has(k))scaleZones.set(k,[]);scaleZones.get(k).push(a);});const recentScaleZones=[...scaleZones.values()].filter(g=>g.length>=2).sort((a,b)=>a[0].time-b[0].time).slice(-24).flat();const visibleAnnotationsForScale=scaleItems.filter(a=>a.time>=visibleStart&&a.type!=="ob"&&a.type!=="fvg").concat(recentScaleZones);visibleAnnotationsForScale.forEach(a=>{lows.push(a.price);highs.push(a.price);});const rawMin=Math.min(...lows),rawMax=Math.max(...highs);
 if(scaleMin===null||scaleMax===null||(scaleWindow!==windowKey&&scaleWindow!=="manual-pan:"+windowKey)){const pad=(rawMax-rawMin)*.08||Math.abs(rawMax)*.0001||1;scaleMin=rawMin-pad;scaleMax=rawMax+pad;scaleWindow=windowKey;}else if(scaleWindow!=="manual-pan:"+windowKey){const span=scaleMax-scaleMin,pad=span*.08;if(rawMin<scaleMin+pad)scaleMin=rawMin-pad;if(rawMax>scaleMax-pad)scaleMax=rawMax+pad;}
 const min=scaleMin,max=scaleMax;
 const yOf=v=>top+(max-v)/(max-min)*ph;
 for(let i=0;i<=4;i++){let v=max-(max-min)*i/4,y=top+ph*i/4;ctx.fillStyle="#8495aa";ctx.textAlign="left";ctx.fillText(v.toFixed(4),w-right+5,y+3);}
 const step=pw/Math.max(1,viewCount),bw=Math.max(1.5,step*.72);
 data.forEach((c,i)=>{let x=left+step*(i+.5),color=c.close>=c.open?"#20c997":"#ff5364";ctx.strokeStyle=color;ctx.fillStyle=color;ctx.beginPath();ctx.moveTo(x,yOf(c.high));ctx.lineTo(x,yOf(c.low));ctx.stroke();let y1=yOf(Math.max(c.open,c.close)),y2=yOf(Math.min(c.open,c.close));ctx.fillRect(x-bw/2,y1,bw,Math.max(1,y2-y1));});
 // EMA overlays are visible; Bollinger stays internal and is never drawn.
 [9,20,50].forEach((period,n)=>{const toggle=document.getElementById("show-ema"+period);if(toggle&&!toggle.checked)return;if(raw.length<period)return;let alpha=2/(period+1),v=raw.slice(0,period).reduce((s,c)=>s+c.close,0)/period,series=Array(raw.length).fill(null);series[period-1]=v;for(let k=period;k<raw.length;k++){v=raw[k].close*alpha+v*(1-alpha);series[k]=v;}ctx.beginPath();let begun=false;for(let k=start;k<end;k++){if(series[k]==null)continue;let x=left+step*(k-start+.5),y=yOf(series[k]);if(!begun){ctx.moveTo(x,y);begun=true;}else ctx.lineTo(x,y);}ctx.strokeStyle=["#f5bd4f","#48a8ff","#bd8cff"][n];ctx.lineWidth=period===50?1.8:1.3;ctx.stroke();});

 // SMC overlays: pivots, liquidity, BOS/CHoCH, OB/FVG and projected zone.

 const tag=(txt,x,y,color)=>{if(!txt)return;ctx.font=(color==="#e2a84a"?"bold 6px Arial":"bold 7px Arial");ctx.textAlign="left";let tw=ctx.measureText(txt).width,tx=Math.max(left,Math.min(w-right-tw-8,x)),ty=Math.max(top+10,Math.min(h-bottom,y));ctx.fillStyle="rgba(8,13,22,.9)";ctx.fillRect(tx,ty-8,tw+6,11);ctx.fillStyle=color;ctx.fillText(txt,tx+3,ty);};
 const allAnnotations=(structureOverlay.items||[]).filter(a=>{const type=String(a.type||"").toLowerCase(),side=String(a.side||"").toUpperCase(),label=String(a.label||"").toUpperCase();return !["choch","sweep"].includes(type)&&!(type==="bos"&&(side==="BEAR"||label.includes("BEAR")))&&Number.isFinite(a.price)&&a.time<=visibleEnd;});const visibleAnnotations=allAnnotations.filter(a=>a.time>=visibleStart);
 const recent=(type,n,side)=>visibleAnnotations.filter(a=>a.type===type&&(!side||a.side===side)).sort((a,b)=>a.time-b.time);
 const annotations=[
  ...(()=>{const pools=visibleAnnotations.filter(a=>a.type==="liquidity"),chosen=[];for(const side of ["BSL","SSL"]){const candidates=pools.filter(a=>String(a.label).includes(side)).sort((a,b)=>b.time-a.time);const levels=[];for(const p of candidates){if(levels.every(q=>Math.abs(q.price-p.price)>Math.max(Math.abs(p.price)*0.00005,1e-8)))levels.push(p);if(levels.length>=5)break;}chosen.push(...levels);}return chosen;})(),
  ...recent("bos",2).filter(a=>a.side==="BULL"),...visibleAnnotations.filter(a=>a.type==="signal"),
  ...(()=>{const a=allAnnotations.filter(v=>v.type==="ob"&&v.time>=visibleStart&&v.time<=visibleEnd).sort((u,v)=>v.time-u.time),groups=new Map();a.forEach(v=>{if(!groups.has(v.time+"|"+v.side))groups.set(v.time+"|"+v.side,[]);groups.get(v.time+"|"+v.side).push(v);});const candidates=[...groups.values()].filter(g=>g.length>=2).map(g=>({items:g,hi:Math.max(...g.map(v=>v.price)),lo:Math.min(...g.map(v=>v.price)),time:g[0].time})).sort((u,v)=>v.time-u.time),kept=[];for(const z of candidates){if(kept.some(k=>z.lo<=k.hi&&z.hi>=k.lo))continue;kept.push(z);}return kept.flatMap(z=>z.items);})()
 ];
 chartPlot={left,right,top,bottom,step,start};
 const xAt=time=>{let ix=candleData.findIndex(v=>v.time>=time);if(ix<0)ix=candleData.length-1;return left+(ix-start+.5)*step;};
 const zoneGroups=new Map();
 annotations.filter(a=>a.type==="ob"||a.type==="fvg").forEach(a=>{const key=[a.type,a.time,a.side].join("|");if(!zoneGroups.has(key))zoneGroups.set(key,[]);zoneGroups.get(key).push(a);});
 zoneGroups.forEach((items,key)=>{if(items.length<2)return;const [type,,side]=key.split("|"),vals=items.map(v=>v.price),topY=yOf(Math.max(...vals)),x=xAt(items[0].time),color=type==="ob"?(side==="BUY"?"#20c997":"#ff5364"):(side==="BUY"?"#48a8ff":"#bd8cff");const bottomY=yOf(Math.min(...vals));ctx.fillStyle=color+(type==="ob"?"20":"12");ctx.fillRect(x,topY,Math.max(18,w-right-x),Math.max(2,bottomY-topY));if(type==="ob"){ctx.strokeStyle=color;ctx.lineWidth=1;ctx.strokeRect(x,topY,Math.max(18,w-right-x),Math.max(2,bottomY-topY));tag(side==="BUY"?"OB ALCISTA":"OB BAJISTA",x+4,Math.max(top+12,topY-5),color);}});
 annotations.forEach(a=>{
  if(a.type==="ob"||a.type==="fvg")return;
  const x=xAt(a.time),y=yOf(a.price);let color="#aab7c8";
  if(a.type==="bos")color=a.side==="BULL"?"#20c997":"#ff5364";
  if(a.type==="choch")color="#f5c451";
  if(a.type==="sweep")color="#bd8cff";
  if(a.type==="liquidity")color="#e2a84a";if(a.type==="signal")color=a.side==="COMPRAR"?"#20c997":"#ff5364";
  if(a.type==="pivot"){
   ctx.fillStyle="#d9e2ef";ctx.beginPath();ctx.arc(x,y,3.2,0,Math.PI*2);ctx.fill();
   tag(a.label==="PIVOTE ALTO"?"PH":"PL",x+4,y-5,"#d9e2ef");return;
  }
  if(a.type==="signal"){ctx.fillStyle=color;ctx.beginPath();ctx.arc(x,y,4,0,Math.PI*2);ctx.fill();tag(a.label==="COMPRAR"?"BUY":"SELL",x+4,y-5,color);return;}ctx.strokeStyle=color;ctx.lineWidth=a.type==="liquidity"?1.5:1.2;ctx.setLineDash(a.type==="liquidity"?[7,4]:[3,3]);ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(a.type==="liquidity"?w-right:Math.min(w-right,x+Math.max(24,step*12)),y);ctx.stroke();ctx.setLineDash([]);
  tag(a.type==="liquidity"?(a.label.includes("BSL")?"BSL":"SSL"):a.label,x+3,y-3,color);
 });
 const p=structureOverlay.projection;if(p&&Number.isFinite(p.low)&&Number.isFinite(p.high)){const col=p.direction==="COMPRAR"?"#20c997":"#ff5364",level=p.direction==="COMPRAR"?p.low:p.high,y=yOf(level);ctx.strokeStyle=col;ctx.globalAlpha=.7;ctx.setLineDash([3,5]);ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(w-right,y);ctx.stroke();ctx.setLineDash([]);ctx.globalAlpha=1;}
 // Historical trade zones and exact price labels.
 visibleTrades.forEach(t=>{
  const entryTime=Number(t.entryTime)/1000,exitTime=Number(t.exitTime||Date.now())/1000;
  const idx=data.findIndex(v=>v.time>=entryTime),endIdx=data.findIndex(v=>v.time>=exitTime);
  const ix=idx<0?data.length-1:idx,ex=endIdx<0?data.length-1:endIdx;
  const x1=left+step*(ix+.5),x2=left+step*(Math.max(ix,ex)+.5);
  const yEntry=yOf(t.entry),yStop=yOf(t.sl),exitPrice=Number(t.price),yExit=Number.isFinite(exitPrice)?yOf(exitPrice):yOf(t.tp2);
  ctx.lineWidth=1.3;ctx.setLineDash([4,3]);
  ctx.strokeStyle="#ff5364";ctx.beginPath();ctx.moveTo(x1,yStop);ctx.lineTo(x2,yStop);ctx.stroke();
  ctx.strokeStyle="#48a8ff";ctx.beginPath();ctx.moveTo(x1,yEntry);ctx.lineTo(x2,yEntry);ctx.stroke();
  ctx.setLineDash([]);
  const dot=(x,y,color)=>{ctx.fillStyle=color;ctx.beginPath();ctx.arc(x,y,4,0,Math.PI*2);ctx.fill();ctx.strokeStyle="#101827";ctx.lineWidth=1;ctx.stroke();};
  dot(x1,yStop,"#ff5364");
  const label=(txt,x,y,color)=>{ctx.font="bold 10px Arial";ctx.textAlign="left";const tw=ctx.measureText(txt).width;ctx.fillStyle="rgba(8,13,22,.88)";ctx.fillRect(x,y-10,tw+8,14);ctx.fillStyle=color;ctx.fillText(txt,x+3,y);};
  label(t.direction==="COMPRAR"?"BUY":"SELL",Math.min(w-right-55,x1+5),yEntry-5,"#70bdff");
  label("SL "+Number(t.sl).toPrecision(7),Math.min(w-right-110,x1+5),yStop-5,"#ff9aa3");
  const yTp2=yOf(t.tp2);
  ctx.strokeStyle="rgba(32,201,151,.48)";ctx.setLineDash([3,4]);ctx.beginPath();ctx.moveTo(x1,yTp2);ctx.lineTo(Math.max(x1+12,x2),yTp2);ctx.stroke();ctx.setLineDash([]);
  label("TP2 "+Number(t.tp2).toPrecision(7),Math.min(w-right-130,x1+5),yTp2-5,"#8de8c8");
  const tp1=Number(t.tp1);
  if(Number.isFinite(tp1)){
   const yTp1=yOf(tp1);
   ctx.strokeStyle="rgba(32,201,151,.48)";ctx.setLineDash([3,4]);ctx.beginPath();ctx.moveTo(x1,yTp1);ctx.lineTo(Math.max(x1+12,x2),yTp1);ctx.stroke();ctx.setLineDash([]);
   label("TP1 "+tp1.toPrecision(7),Math.min(w-right-130,x1+5),yTp1-5,"#8de8c8");
  }
  if(t.exitTime&&Number.isFinite(exitPrice)){
   const won=t.result==="GANADA";dot(x2,yExit,won?"#20c997":"#ff5364");
   const resultText=won?"GANADA":"PERDIDA";
   label(resultText+" · "+exitPrice.toPrecision(7),Math.min(w-right-145,x2+5),Math.max(top+12,yExit-19),won?"#43e0b0":"#ff7180");
  }
 });
 const drawUserShape=d=>{const y1=yOf(d.p1??d.price),y2=yOf(d.p2??d.price);if(d.type==="line"){ctx.strokeStyle="#f4c45e";ctx.lineWidth=1.6;ctx.setLineDash([6,4]);ctx.beginPath();ctx.moveTo(left,y1);ctx.lineTo(w-right,y1);ctx.stroke();ctx.setLineDash([]);tag("NIVEL",left+5,y1-5,"#f4c45e");}else{const x1=left+(Math.min(d.x1,d.x2)-start+.5)*step,x2=left+(Math.max(d.x1,d.x2)-start+.5)*step,yt=Math.min(y1,y2),yb=Math.max(y1,y2);ctx.fillStyle="rgba(72,168,255,.13)";ctx.fillRect(x1,yt,Math.max(3,x2-x1),Math.max(3,yb-yt));ctx.strokeStyle="#48a8ff";ctx.lineWidth=1.4;ctx.strokeRect(x1,yt,Math.max(3,x2-x1),Math.max(3,yb-yt));}};userDrawings.forEach(drawUserShape);if(pendingDrawing)drawUserShape(pendingDrawing);
 tradeLevels.forEach((a,i)=>{const y=yOf(a.value);ctx.strokeStyle=a.color;ctx.globalAlpha=.72;ctx.lineWidth=1;ctx.setLineDash(i===0?[]:[4,4]);ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(w-right,y);ctx.stroke();ctx.setLineDash([]);ctx.globalAlpha=1;const tag=a.label+"  "+Number(a.value).toPrecision(7);ctx.font="bold 9px Arial";const tw=ctx.measureText(tag).width+10;ctx.fillStyle="rgba(8,13,22,.88)";ctx.fillRect(w-right+2,y-8,Math.min(right-4,tw),15);ctx.fillStyle=a.color;ctx.textAlign="left";ctx.fillText(tag,w-right+7,y+3);}); if(signalMarker){const si=data.findIndex(v=>v.time===signalMarker.time);if(si>=0){const candle=data[si],sx=left+step*(si+.5),sy=yOf(signalMarker.direction==="COMPRAR"?candle.low:candle.high);ctx.fillStyle=signalMarker.direction==="COMPRAR"?"#20c997":"#ff5364";ctx.beginPath();if(signalMarker.direction==="COMPRAR"){ctx.moveTo(sx,sy+10);ctx.lineTo(sx-6,sy+20);ctx.lineTo(sx+6,sy+20);}else{ctx.moveTo(sx,sy-10);ctx.lineTo(sx-6,sy-20);ctx.lineTo(sx+6,sy-20);}ctx.closePath();ctx.fill();ctx.font="bold 9px Arial";ctx.textAlign="center";ctx.fillText(signalMarker.direction,sx,signalMarker.direction==="COMPRAR"?sy+31:sy-24);}}
 ctx.fillStyle="#8495aa";ctx.textAlign="left";ctx.fillText((candleStyle==="heikin"?"HEIKIN ASHI":"VELAS NORMALES")+" · "+(chartGranularity===30?"30s":"M"+(chartGranularity/60))+" · "+data.length+" velas",left,h-7);ctx.textAlign="right";ctx.fillText(new Date(data[data.length-1].time*1000).toLocaleTimeString("es-PA",{hour:"2-digit",minute:"2-digit"}),w-right,h-7);{const remain=chartGranularity-(Math.floor(Date.now()/1000)%chartGranularity);const mm=String(Math.floor(remain/60)).padStart(2,"0"),ss=String(remain%60).padStart(2,"0");ctx.textAlign="left";ctx.font="bold 11px Arial";ctx.fillStyle="#f5c451";ctx.fillText("CIERRE "+(chartGranularity===30?"30s":"M"+(chartGranularity/60))+" "+mm+":"+ss,left+4,top+13);}
}
function setCandleStyle(style){candleStyle=style==="normal"?"normal":"heikin";drawMarketChart();}
window.addEventListener("resize",resizeMarketChart);
setInterval(()=>{if(candleData.length)drawMarketChart();},1000);
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",createMarketChart);else createMarketChart();

document.addEventListener("DOMContentLoaded",()=>{[9,20,50].forEach(p=>{const el=document.getElementById("show-ema"+p);if(el)el.addEventListener("change",()=>drawMarketChart());});});
