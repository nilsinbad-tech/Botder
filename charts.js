let candleData=[],chartSymbol=null,tradeLevels=[],signalMarker=null,chartCanvas=null,chartContext=null,resizeObserver=null,candleStyle="normal";
let liveVisualPrice=null,liveFromPrice=null,liveToPrice=null,liveAnimationStart=0,liveAnimationFrame=null;
let backtestTradeData=[];let structureOverlay={items:[],projection:null};let liveChartPrice=null;
let viewEnd=0,viewCount=100,followLive=true,dragX=null,dragEnd=0,activePointers=new Map(),pinchStart=0,pinchCount=100,pinchAnchorIndex=0,pinchAnchorRatio=.5,chartFrame=null,scaleMin=null,scaleMax=null,scaleWindow="",chartGranularity=60;let lastPanDelta=0,lastPanAt=0,panMomentumFrame=null;const futureSpace=25;let drawingMode="pan",userDrawings=[],pendingDrawing=null,priceScaleDrag=null,verticalPanDrag=null,chartPlot={left:10,right:66,top:16,bottom:25,step:1,start:0};
function createMarketChart(containerId="chart-area"){
 const host=document.getElementById(containerId);if(!host)return false;
 // Evita crear un segundo canvas sobre el primero: app.js y este archivo podían inicializar el mismo gráfico.
 if(chartCanvas&&chartCanvas.isConnected&&chartCanvas.parentElement===host&&chartContext)return true;
 host.innerHTML="";chartCanvas=document.createElement("canvas");
 chartCanvas.style.cssText="position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;cursor:grab";
 host.appendChild(chartCanvas);const tools=document.createElement("div");tools.style.cssText="position:absolute;z-index:5;top:8px;right:72px;left:auto;display:flex;gap:3px;flex-wrap:wrap;justify-content:flex-end;max-width:calc(100% - 86px)";[["pan","MOVER"],["line","LÍNEA"],["zone","ZONA"],["clear","BORRAR"]].forEach(([mode,label])=>{const b=document.createElement("button");b.type="button";b.textContent=label;b.style.cssText="border:1px solid #48617e;border-radius:6px;background:#101d2d;color:#e8f0fa;padding:4px 6px;font-size:8px;font-weight:700";b.addEventListener("click",()=>{if(mode==="clear"){userDrawings=[];pendingDrawing=null;}else drawingMode=mode;tools.querySelectorAll("button").forEach(x=>x.style.background=x===b?"#245b78":"#101d2d");drawMarketChart();});tools.appendChild(b);});[["zoom-in","+"],["zoom-out","−"],["reset-view","AJUSTAR"]].forEach(([action,label])=>{const b=document.createElement("button");b.type="button";b.textContent=label;b.title=action==="zoom-in"?"Acercar":action==="zoom-out"?"Alejar":"Volver a vista actual";b.style.cssText="border:1px solid #48617e;border-radius:6px;background:#101d2d;color:#e8f0fa;padding:4px 6px;font-size:8px;font-weight:700";b.addEventListener("click",()=>{if(action==="reset-view"){viewCount=100;viewEnd=candleData.length+futureSpace;followLive=true;scaleMin=null;scaleMax=null;scaleWindow="";}else{const ratio=.5,end=Math.max(0,Math.min(candleData.length+viewCount-1,viewEnd||candleData.length+futureSpace)),start=Math.max(0,end-viewCount),anchor=start+ratio*viewCount;viewCount=Math.max(15,Math.min(5000,Math.round(viewCount*(action==="zoom-in"?.75:1.33))));viewEnd=Math.max(Math.min(viewCount,candleData.length),Math.min(candleData.length+viewCount-1,Math.round(anchor+(1-ratio)*viewCount)));followLive=false;}drawMarketChart();});tools.appendChild(b);});(document.querySelector(".chart-configuration")||host).appendChild(tools);tools.style.position="relative";tools.style.top="auto";tools.style.right="auto";tools.style.left="auto";tools.style.maxWidth="100%";tools.style.justifyContent="flex-start";
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
   lastPanDelta=0;
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
  if(verticalPanDrag&&activePointers.size===1){const plotHeight=Math.max(1,chartCanvas.parentElement.clientHeight-chartPlot.top-chartPlot.bottom),shift=(e.clientY-verticalPanDrag.y)/plotHeight*(verticalPanDrag.max-verticalPanDrag.min);scaleMin=verticalPanDrag.min+shift;scaleMax=verticalPanDrag.max+shift;scaleWindow="manual-pan";drawMarketChart();}
  if(activePointers.size>=2){
   const p=[...activePointers.values()],dist=Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y);
   if(pinchStart>0){
    // Zoom suave: pellizcar acerca/aleja las velas y conserva el punto bajo el centro de los dedos.
    viewCount=Math.max(15,Math.min(5000,Math.round(pinchCount*pinchStart/Math.max(1,dist))));
    const rect=chartCanvas.getBoundingClientRect(),mid=(p[0].x+p[1].x)/2;
    pinchAnchorRatio=Math.max(0,Math.min(1,(mid-rect.left-10)/Math.max(1,rect.width-76)));
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
 chartCanvas.addEventListener("wheel",e=>{e.preventDefault();followLive=false;const rect=chartCanvas.getBoundingClientRect(),ratio=Math.max(0,Math.min(1,(e.clientX-rect.left-10)/Math.max(1,rect.width-76))),end=Math.max(0,Math.min(candleData.length+viewCount-1,viewEnd||candleData.length+futureSpace)),start=Math.max(0,end-viewCount),anchor=start+ratio*viewCount;viewCount=Math.max(15,Math.min(5000,Math.round(viewCount*(e.deltaY>0?1.2:.82))));const nextEnd=anchor+(1-ratio)*viewCount;viewEnd=Math.max(Math.min(viewCount,candleData.length),Math.min(candleData.length+viewCount-1,Math.round(nextEnd)));drawMarketChart();},{passive:false});
 resizeMarketChart();drawMarketChart();return true;
}
function chartPoint(e){if(!chartCanvas)return null;const r=chartCanvas.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top,p=chartPlot;if(x<p.left||x>r.width-p.right||y<p.top||y>r.height-p.bottom||!Number.isFinite(scaleMin)||!Number.isFinite(scaleMax))return null;return {price:scaleMax-(y-p.top)/(r.height-p.top-p.bottom)*(scaleMax-scaleMin),index:p.start+(x-p.left)/p.step-.5};}
function resizeMarketChart(){if(!chartCanvas||!chartContext)return;const host=chartCanvas.parentElement;if(!host)return;const r=host.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2);chartCanvas.width=Math.max(1,Math.floor(r.width*dpr));chartCanvas.height=Math.max(1,Math.floor(r.height*dpr));chartContext.setTransform(dpr,0,0,dpr,0,0);drawMarketChart();}
function setChartSymbol(s){chartSymbol=s;liveChartPrice=null;candleData=[];tradeLevels=[];signalMarker=null;structureOverlay={items:[],lines:[],projection:null};followLive=true;viewEnd=0;viewCount=100;userDrawings=[];pendingDrawing=null;scaleMin=null;scaleMax=null;scaleWindow="";drawMarketChart();}
function setLiveChartPrice(price){const v=Number(price);if(!Number.isFinite(v))return;const now=performance.now();liveFromPrice=Number.isFinite(liveVisualPrice)?liveVisualPrice:(Number.isFinite(liveChartPrice)?liveChartPrice:v);liveToPrice=v;liveAnimationStart=now;liveChartPrice=v;if(liveAnimationFrame===null){const animate=()=>{const t=Math.min(1,(performance.now()-liveAnimationStart)/650);const eased=1-Math.pow(1-t,3);liveVisualPrice=liveFromPrice+(liveToPrice-liveFromPrice)*eased;drawMarketChart();if(t<1)liveAnimationFrame=requestAnimationFrame(animate);else{liveVisualPrice=liveToPrice;liveAnimationFrame=null;}};liveAnimationFrame=requestAnimationFrame(animate);}}
function setChartGranularity(seconds){const next=Number(seconds)||60;if(next!==chartGranularity){followLive=true;viewEnd=0;}chartGranularity=next;scaleMin=null;scaleMax=null;scaleWindow="";drawMarketChart();}
function updateCandles(c){if(!Array.isArray(c))return;const oldLength=candleData.length,wasFollowing=followLive,distanceFromEnd=Math.max(0,oldLength-viewEnd);candleData=c.filter(x=>[x.time,x.open,x.high,x.low,x.close].every(Number.isFinite)).sort((a,b)=>a.time-b.time).slice();viewEnd=wasFollowing||viewEnd<=0?candleData.length+futureSpace:Math.max(Math.min(viewCount,candleData.length),Math.min(candleData.length+viewCount-1,viewEnd));drawMarketChart();}
function addCandle(c){if(!c||![c.time,c.open,c.high,c.low,c.close].every(Number.isFinite))return;const oldLength=candleData.length,last=candleData[oldLength-1];if(last&&last.time===c.time)candleData[oldLength-1]=c;else candleData.push(c);if(followLive)viewEnd=candleData.length+futureSpace;drawMarketChart();}
function setChartBacktestTrades(trades){backtestTradeData=Array.isArray(trades)?trades.slice():[];drawMarketChart();}
function setStructureOverlay(data){const hiddenTypes=new Set(["choch","sweep"]);structureOverlay={...(data||{}),items:Array.isArray(data?.items)?data.items.filter(a=>{const type=String(a.type||"").toLowerCase(),side=String(a.side||"").toUpperCase(),label=String(a.label||"").toUpperCase();return !hiddenTypes.has(type)&&!(type==="bos"&&(side==="BEAR"||label.includes("BEAR")));}):[],lines:Array.isArray(data?.lines)?data.lines:[],projection:data?.projection||null};drawMarketChart();}
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
function drawTradeLevels(signal){if(!signal)return;tradeLevels=[{value:Number(signal.entry),label:"ENTRADA",color:"#61b7ff"},{value:Number(signal.sl),label:"SL",color:"#ff6579"},{value:Number(signal.tp1),label:"TP1",color:"#ffd166"},{value:Number(signal.tp2),label:"TP2",color:"#39e6a0"}].filter(x=>Number.isFinite(x.value));signalMarker=Number.isFinite(Number(signal.time))?{time:Number(signal.time),direction:signal.direction}:null;drawMarketChart();}
function clearTradeLevels(){tradeLevels=[];drawMarketChart();}
function getActiveChartSymbol(){return chartSymbol;}
function drawMarketChart(){if(chartFrame!==null)return;chartFrame=requestAnimationFrame(()=>{chartFrame=null;renderMarketChart();});}
function renderMarketChart(){
 if(!chartCanvas||!chartContext)return;const ctx=chartContext,w=chartCanvas.parentElement?.clientWidth||0,h=chartCanvas.parentElement?.clientHeight||0;if(!w||!h)return;
 ctx.clearRect(0,0,w,h);ctx.fillStyle="#081321";ctx.fillRect(0,0,w,h);
 const left=10,right=66,top=16,bottom=25,pw=w-left-right,ph=h-top-bottom;
 ctx.font="8px Arial";ctx.strokeStyle="#1c3047";ctx.lineWidth=.7;
 for(let i=0;i<=4;i++){let y=top+ph*i/4;ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(w-right,y);ctx.stroke();}
 if(!candleData.length){ctx.fillStyle="#8fa3b9";ctx.textAlign="center";ctx.font="12px Arial";ctx.fillText("Esperando datos reales del mercado...",w/2,h/2);return;}
 const end=Math.max(0,Math.min(candleData.length+viewCount-1,viewEnd||candleData.length+futureSpace)),start=Math.max(0,end-viewCount),raw=candleStyle==="heikin"?toHeikinAshi(candleData):candleData,data=raw.slice(start,Math.min(end,candleData.length));
 // Suaviza visualmente el movimiento de la vela abierta entre ticks reales, sin modificar el OHLC guardado.
 if(data.length&&Number.isFinite(liveVisualPrice)&&data[data.length-1].time===candleData[candleData.length-1]?.time){const last=data[data.length-1];data[data.length-1]={...last,close:liveVisualPrice,high:Math.max(last.high,liveVisualPrice),low:Math.min(last.low,liveVisualPrice)};}
 if(!data.length)return;const windowKey=start+":"+end+":"+viewCount;let lows=data.map(c=>c.low),highs=data.map(c=>c.high);const visibleStart=data[0].time,visibleEnd=data[data.length-1].time;const visibleTrades=backtestTradeData.filter(t=>{const et=Number(t.entryTime)/1000,xt=Number(t.exitTime||Date.now())/1000;return Number.isFinite(et)&&et<=visibleEnd&&xt>=visibleStart;});visibleTrades.forEach(t=>[t.entry,t.sl,t.tp1,t.tp2,t.price].forEach(v=>{v=Number(v);if(Number.isFinite(v)){lows.push(v);highs.push(v);}}));const candleMin=Math.min(...data.map(c=>c.low)),candleMax=Math.max(...data.map(c=>c.high));if(Number.isFinite(liveChartPrice)){lows.push(liveChartPrice);highs.push(liveChartPrice);}
 const scaleItems=(structureOverlay.items||[]).filter(a=>Number.isFinite(a.price)&&a.time<=visibleEnd),scaleZones=new Map();scaleItems.filter(a=>a.type==="ob"||a.type==="fvg").forEach(a=>{const k=a.type+"|"+a.time+"|"+a.side;if(!scaleZones.has(k))scaleZones.set(k,[]);scaleZones.get(k).push(a);});const recentScaleZones=[...scaleZones.values()].filter(g=>g.length>=2).sort((a,b)=>a[0].time-b[0].time).slice(-24).flat();const visibleAnnotationsForScale=scaleItems.filter(a=>a.time>=visibleStart&&a.type!=="ob"&&a.type!=="fvg").concat(recentScaleZones);visibleAnnotationsForScale.forEach(a=>{lows.push(a.price);highs.push(a.price);});const pp=structureOverlay.projection;if(pp){[pp.zoneLow,pp.zoneHigh,pp.entry,pp.sl,pp.tp].forEach(v=>{if(Number.isFinite(Number(v))){lows.push(Number(v));highs.push(Number(v));}});}const rawMin=Math.min(...lows),rawMax=Math.max(...highs);
 if(scaleMin===null||scaleMax===null||(scaleWindow!==windowKey&&scaleWindow!=="manual-pan")){const pad=(rawMax-rawMin)*.08||Math.abs(rawMax)*.0001||1;scaleMin=rawMin-pad;scaleMax=rawMax+pad;scaleWindow=windowKey;}else if(scaleWindow!=="manual-pan"){const span=scaleMax-scaleMin,pad=span*.08;if(rawMin<scaleMin+pad)scaleMin=rawMin-pad;if(rawMax>scaleMax-pad)scaleMax=rawMax+pad;}
 const min=scaleMin,max=scaleMax;
 const yOf=v=>top+(max-v)/(max-min)*ph;
 for(let i=0;i<=4;i++){let v=max-(max-min)*i/4,y=top+ph*i/4;ctx.fillStyle="#8fa3b9";ctx.textAlign="left";ctx.fillText(v.toFixed(4),w-right+5,y+3);}
 const step=pw/Math.max(1,viewCount),bw=Math.max(1.5,step*.72);
 data.forEach((c,i)=>{let x=left+step*(i+.5),color=c.close>=c.open?"#39e6a0":"#ff6579";ctx.strokeStyle=color;ctx.fillStyle=color;ctx.beginPath();ctx.moveTo(x,yOf(c.high));ctx.lineTo(x,yOf(c.low));ctx.stroke();let y1=yOf(Math.max(c.open,c.close)),y2=yOf(Math.min(c.open,c.close));ctx.fillRect(x-bw/2,y1,bw,Math.max(1,y2-y1));});
 // EMA overlays are visible; Bollinger stays internal and is never drawn.
 [9,20,50].forEach((period,n)=>{const toggle=document.getElementById("show-ema"+period);if(toggle&&!toggle.checked)return;if(raw.length<period)return;let alpha=2/(period+1),v=raw.slice(0,period).reduce((s,c)=>s+c.close,0)/period,series=Array(raw.length).fill(null);series[period-1]=v;for(let k=period;k<raw.length;k++){v=raw[k].close*alpha+v*(1-alpha);series[k]=v;}ctx.beginPath();let begun=false;for(let k=start;k<end;k++){if(series[k]==null)continue;let x=left+step*(k-start+.5),y=yOf(series[k]);if(!begun){ctx.moveTo(x,y);begun=true;}else ctx.lineTo(x,y);}ctx.strokeStyle=["#f5bd4f","#61b7ff","#bd8cff"][n];ctx.lineWidth=period===50?1.15:.85;ctx.stroke();});

 // SMC overlays: pivots, liquidity, BOS/CHoCH, OB/FVG and projected zone.

 const tag=(txt,x,y,color)=>{if(!txt)return;ctx.font=(color==="#e2a84a"?"bold 5px Arial":"bold 6px Arial");ctx.textAlign="left";let tw=ctx.measureText(txt).width,tx=Math.max(left,Math.min(w-right-tw-8,x)),ty=Math.max(top+10,Math.min(h-bottom,y));ctx.fillStyle="rgba(8,13,22,.9)";ctx.fillRect(tx,ty-8,tw+6,11);ctx.fillStyle=color;ctx.fillText(txt,tx+3,ty);};
 const allAnnotations=(structureOverlay.items||[]).filter(a=>{const type=String(a.type||"").toLowerCase(),side=String(a.side||"").toUpperCase(),label=String(a.label||"").toUpperCase();return !["choch","sweep"].includes(type)&&!(type==="bos"&&(side==="BEAR"||label.includes("BEAR")))&&Number.isFinite(a.price)&&a.time<=visibleEnd;});const visibleAnnotations=allAnnotations.filter(a=>a.time>=visibleStart);
 const recent=(type,n,side)=>visibleAnnotations.filter(a=>a.type===type&&(!side||a.side===side)).sort((a,b)=>a.time-b.time);
 const annotations=[
  ...(()=>{const pools=visibleAnnotations.filter(a=>a.type==="liquidity"),chosen=[];for(const side of ["BSL","SSL"]){const candidates=pools.filter(a=>String(a.label).includes(side)).sort((a,b)=>b.time-a.time);const levels=[];for(const p of candidates){if(levels.every(q=>Math.abs(q.price-p.price)>Math.max(Math.abs(p.price)*0.00005,1e-8)))levels.push(p);if(levels.length>=5)break;}chosen.push(...levels);}return chosen;})(),
  ...recent("bos",2).filter(a=>a.side==="BULL"),...visibleAnnotations.filter(a=>a.type==="signal"),
  ...(()=>{const a=allAnnotations.filter(v=>v.type==="ob"&&v.time>=visibleStart&&v.time<=visibleEnd).sort((u,v)=>v.time-u.time),groups=new Map();a.forEach(v=>{if(!groups.has(v.time+"|"+v.side))groups.set(v.time+"|"+v.side,[]);groups.get(v.time+"|"+v.side).push(v);});const candidates=[...groups.values()].filter(g=>g.length>=2).map(g=>({items:g,hi:Math.max(...g.map(v=>v.price)),lo:Math.min(...g.map(v=>v.price)),time:g[0].time,active:g.some(v=>v.active)})).sort((u,v)=>Number(v.active)-Number(u.active)||v.time-u.time),kept=[];for(const z of candidates){if(!z.active&&kept.some(k=>z.lo<=k.hi&&z.hi>=k.lo))continue;kept.push(z);}return kept.flatMap(z=>z.items);})()
 ];
 chartPlot={left,right,top,bottom,step,start};
 const xAt=time=>{let ix=candleData.findIndex(v=>v.time>=time);if(ix<0)ix=candleData.length-1;return left+(ix-start+.5)*step;};
 const timeIndex=time=>{let ix=candleData.findIndex(v=>v.time>=time);if(ix<0){const last=candleData.at(-1);return last?candleData.length+(time-last.time)/Math.max(1,chartGranularity):candleData.length;}return ix;};
 (structureOverlay.lines||[]).forEach(line=>{if(![line.time1,line.time2,line.price1,line.price2].every(Number.isFinite))return;const i1=timeIndex(line.time1),i2=timeIndex(line.time2),slope=(line.price2-line.price1)/Math.max(1,i2-i1);if(i1>start+viewCount)return;const drawStart=Math.max(start,i1),priceStart=line.price1+slope*(drawStart-i1),x1=left+(drawStart-start+.5)*step,x2=left+viewCount*step,priceEnd=line.price2+slope*(start+viewCount-i2),y1=yOf(priceStart),y2=yOf(priceEnd),color=line.side==="BUY"?"#39e6a0":"#ff6878";ctx.save();ctx.strokeStyle=color;ctx.lineWidth=line.primary?2:1.2;ctx.globalAlpha=line.primary?.95:.58;ctx.setLineDash(line.primary?[]:[5,4]);ctx.beginPath();ctx.moveTo(Math.max(left,x1),y1);ctx.lineTo(Math.min(w-right,x2),y2);ctx.stroke();ctx.setLineDash([]);if(line.label){ctx.font="bold 8px Arial";ctx.fillStyle=color;ctx.textAlign="left";ctx.fillText(line.label,Math.max(left,Math.min(w-right-110,x2-100)),Math.max(top+10,Math.min(h-bottom-5,y2-5)));}(line.touches||[]).forEach((t,n)=>{const ix=timeIndex(t.time),tx=left+(ix-start+.5)*step,ty=yOf(t.price);if(tx<left||tx>w-right)return;ctx.fillStyle=color;ctx.beginPath();ctx.arc(tx,ty,3.5,0,Math.PI*2);ctx.fill();ctx.font="bold 8px Arial";ctx.textAlign="center";ctx.fillText(String(t.n||n+1),tx,ty-7);});if(line.primary&&(line.touches||[]).length===2&&Number.isFinite(line.projectTime)){const ix=timeIndex(line.projectTime),tx=left+(ix-start+.5)*step,price=line.price2+slope*(ix-i2),ty=yOf(price);if(tx>=left&&tx<=w-right){ctx.strokeStyle="#ffd166";ctx.fillStyle="#0b1726";ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(tx,ty,5,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.font="bold 8px Arial";ctx.fillStyle="#ffd166";ctx.textAlign="center";ctx.fillText("3º PREVISTO",tx,ty-9);}}ctx.restore();});
 const zoneGroups=new Map();
 annotations.filter(a=>a.type==="ob"||a.type==="fvg").forEach(a=>{const key=[a.type,a.time,a.side].join("|");if(!zoneGroups.has(key))zoneGroups.set(key,[]);zoneGroups.get(key).push(a);});
  zoneGroups.forEach((items,key)=>{
   if(items.length<2)return;
   const [type,,side]=key.split("|"),vals=items.map(v=>v.price),rawTop=yOf(Math.max(...vals)),rawBottom=yOf(Math.min(...vals)),x=xAt(items[0].time),color=type==="ob"?(side==="BUY"?"#39e6a0":"#ff6579"):(side==="BUY"?"#61b7ff":"#bd8cff"),active=type==="ob"&&items.some(v=>v.active);
   const zoneWidth=active?Math.min(w-right-left,Math.max(190,step*3)):Math.max(5,Math.min(w-right-left,step*3)),zoneX=Math.max(left,Math.min(w-right-zoneWidth,x-step*2));
   const zoneHeight=Math.max(2,rawBottom-rawTop),zoneTop=rawTop;
   ctx.fillStyle=color+(type==="ob"?(active?"48":"20"):"12");ctx.fillRect(zoneX,zoneTop,zoneWidth,zoneHeight);
   if(type==="ob"){
    ctx.strokeStyle=active?"#ffd166":color;ctx.lineWidth=active?2:1;ctx.strokeRect(zoneX,zoneTop,zoneWidth,zoneHeight);
    if(active){ctx.shadowColor="#ffd166";ctx.shadowBlur=7;ctx.strokeRect(zoneX,zoneTop,zoneWidth,zoneHeight);ctx.shadowBlur=0;}
    tag(active?(side==="BUY"?"★ OB COMPRA":"★ OB VENTA"):(side==="BUY"?"OB ALCISTA":"OB BAJISTA"),zoneX+4,Math.max(top+10,zoneTop+10),active?"#ffd166":color);

   }
  });
 annotations.forEach(a=>{
  if(a.type==="ob"||a.type==="fvg")return;
  const x=xAt(a.time),y=yOf(a.price);let color="#aab7c8";
  if(a.type==="bos")color=a.side==="BULL"?"#39e6a0":"#ff6579";
  if(a.type==="choch")color="#ffd166";
  if(a.type==="sweep")color="#bd8cff";
  if(a.type==="liquidity")color="#e2a84a";if(a.type==="signal")color=a.side==="COMPRAR"?"#39e6a0":"#ff6579";
  if(a.type==="pivot"){
   ctx.fillStyle="#d9e2ef";ctx.beginPath();ctx.arc(x,y,3.2,0,Math.PI*2);ctx.fill();
   tag(a.label==="PIVOTE ALTO"?"PH":"PL",x+4,y-5,"#d9e2ef");return;
  }
  if(a.type==="signal"){ctx.fillStyle=color;ctx.beginPath();ctx.arc(x,y,4,0,Math.PI*2);ctx.fill();tag(a.label==="COMPRAR"?"BUY":"SELL",x+4,y-5,color);return;}ctx.strokeStyle=color;ctx.lineWidth=a.type==="liquidity"?.8:.7;ctx.setLineDash(a.type==="liquidity"?[4,4]:[2,3]);ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(Math.min(w-right,x+Math.max(12,step*4)),y);ctx.stroke();ctx.setLineDash([]);
  tag(a.type==="liquidity"?(a.label.includes("BSL")?"BSL":"SSL"):a.label,x+3,y-3,color);
 });
 const p=structureOverlay.projection;if(p&&Number.isFinite(p.zoneLow)&&Number.isFinite(p.zoneHigh)&&Number.isFinite(p.projectTime)){const buy=p.direction==="COMPRAR",col=buy?"#39e6a0":"#ff6579",ix=timeIndex(p.projectTime),x1=left+(ix-start+.5)*step,boxW=Math.max(22,step*5),x2=Math.min(w-right,x1+boxW),yt=yOf(p.zoneHigh),yb=yOf(p.zoneLow);if(x2>=left&&x1<=w-right){ctx.save();ctx.fillStyle=buy?"rgba(57,230,160,.17)":"rgba(255,101,121,.17)";ctx.strokeStyle=col;ctx.lineWidth=1.6;ctx.fillRect(Math.max(left,x1),yt,Math.max(4,x2-Math.max(left,x1)),Math.max(4,yb-yt));ctx.strokeRect(Math.max(left,x1),yt,Math.max(4,x2-Math.max(left,x1)),Math.max(4,yb-yt));ctx.setLineDash([4,3]);[[p.entry,"ENTRADA",col],[p.sl,"SL","#ff6579"],[p.tp,"TP","#61b7ff"]].forEach(([v,label,color])=>{if(!Number.isFinite(Number(v)))return;const y=yOf(Number(v));ctx.strokeStyle=color;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(Math.max(left,x1),y);ctx.lineTo(x2,y);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle=color;ctx.font="bold 8px Arial";ctx.textAlign="left";ctx.fillText(label+" "+Number(v).toPrecision(7),Math.min(w-right-82,Math.max(left,x1)+3),Math.max(top+9,Math.min(h-bottom-4,y-4)));ctx.setLineDash([4,3]);});ctx.setLineDash([]);ctx.fillStyle=col;ctx.font="bold 9px Arial";ctx.textAlign="left";ctx.fillText(buy?"COMPRA FUTURA":"VENTA FUTURA",Math.max(left,Math.min(w-right-105,x1+3)),Math.max(top+11,yt-7));ctx.restore();}}
 // Línea y etiqueta persistentes del último tick. Si se navega por el histórico y el precio queda fuera de escala, se fija un indicador en el borde visible.
 if(Number.isFinite(liveChartPrice)){const outside=liveChartPrice>max||liveChartPrice<min,py=Math.max(top+2,Math.min(h-bottom-2,yOf(liveChartPrice))),priceText=liveChartPrice.toFixed( Math.max(2,Math.min(8,Math.max(0,(String(liveChartPrice).split(".")[1]||"").length))) );ctx.save();ctx.strokeStyle="#ffd166";ctx.lineWidth=1;ctx.setLineDash(outside?[2,3]:[4,3]);ctx.beginPath();ctx.moveTo(left,py);ctx.lineTo(w-right,py);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle="#ffd166";ctx.fillRect(w-right+1,py-12,right-2,24);ctx.fillStyle="#081321";ctx.font="bold 10px Arial";ctx.textAlign="left";ctx.fillText((outside?(liveChartPrice>max?"↑ ":"↓ "):"")+priceText,w-right+4,py+4);ctx.fillStyle="#ffd166";ctx.font="bold 9px Arial";ctx.textAlign="left";ctx.fillText("PRECIO ACTUAL",left+5,Math.max(top+12,Math.min(h-bottom-5,py-7)));ctx.beginPath();ctx.fillStyle="#ffd166";ctx.arc(w-right-3,py,3,0,Math.PI*2);ctx.fill();ctx.restore();}
 // Historical trade zones and exact price labels.
 visibleTrades.forEach(t=>{
  const entryTime=Number(t.entryTime)/1000,exitTime=Number(t.exitTime||Date.now())/1000;
  const idx=data.findIndex(v=>v.time>=entryTime),endIdx=data.findIndex(v=>v.time>=exitTime);
  const ix=idx<0?data.length-1:idx,ex=endIdx<0?data.length-1:endIdx;
  const x1=left+step*(ix+.5),x2=left+step*(Math.max(ix,ex)+.5);
  const yEntry=yOf(t.entry),exitPrice=Number(t.price),yExit=Number.isFinite(exitPrice)?yOf(exitPrice):yEntry;
  ctx.lineWidth=1.3;ctx.setLineDash([4,3]);
  ctx.strokeStyle="#61b7ff";ctx.beginPath();ctx.moveTo(x1,yEntry);ctx.lineTo(x2,yEntry);ctx.stroke();
  ctx.setLineDash([]);
  const dot=(x,y,color)=>{ctx.fillStyle=color;ctx.beginPath();ctx.arc(x,y,4,0,Math.PI*2);ctx.fill();ctx.strokeStyle="#101827";ctx.lineWidth=1;ctx.stroke();};
  const label=(txt,x,y,color)=>{ctx.font="bold 10px Arial";ctx.textAlign="left";const tw=ctx.measureText(txt).width;ctx.fillStyle="rgba(8,13,22,.88)";ctx.fillRect(x,y-10,tw+8,14);ctx.fillStyle=color;ctx.fillText(txt,x+3,y);};
  label(t.direction==="COMPRAR"?"BUY":"SELL",Math.min(w-right-55,x1+5),yEntry-5,"#70bdff");
  if(t.exitTime&&Number.isFinite(exitPrice)){
   const won=t.result==="GANADA";dot(x2,yExit,won?"#39e6a0":"#ff6579");
   const resultText=won?"GANADA":"PERDIDA";
   label(resultText+" · "+exitPrice.toPrecision(7),Math.min(w-right-145,x2+5),Math.max(top+12,yExit-19),won?"#43e0b0":"#ff7180");
  }
 });
 const drawUserShape=d=>{const y1=yOf(d.p1??d.price),y2=yOf(d.p2??d.price);if(d.type==="line"){ctx.strokeStyle="#f4c45e";ctx.lineWidth=1.6;ctx.setLineDash([6,4]);ctx.beginPath();ctx.moveTo(left,y1);ctx.lineTo(w-right,y1);ctx.stroke();ctx.setLineDash([]);tag("NIVEL",left+5,y1-5,"#f4c45e");}else{const x1=left+(Math.min(d.x1,d.x2)-start+.5)*step,x2=left+(Math.max(d.x1,d.x2)-start+.5)*step,yt=Math.min(y1,y2),yb=Math.max(y1,y2);ctx.fillStyle="rgba(72,168,255,.13)";ctx.fillRect(x1,yt,Math.max(3,x2-x1),Math.max(3,yb-yt));ctx.strokeStyle="#61b7ff";ctx.lineWidth=1.4;ctx.strokeRect(x1,yt,Math.max(3,x2-x1),Math.max(3,yb-yt));}};userDrawings.forEach(drawUserShape);if(pendingDrawing)drawUserShape(pendingDrawing);  if(signalMarker){const si=data.findIndex(v=>v.time===signalMarker.time);if(si>=0){const candle=data[si],sx=left+step*(si+.5),sy=yOf(signalMarker.direction==="COMPRAR"?candle.low:candle.high);ctx.fillStyle=signalMarker.direction==="COMPRAR"?"#39e6a0":"#ff6579";ctx.beginPath();if(signalMarker.direction==="COMPRAR"){ctx.moveTo(sx,sy+10);ctx.lineTo(sx-6,sy+20);ctx.lineTo(sx+6,sy+20);}else{ctx.moveTo(sx,sy-10);ctx.lineTo(sx-6,sy-20);ctx.lineTo(sx+6,sy-20);}ctx.closePath();ctx.fill();ctx.font="bold 7px Arial";ctx.textAlign="center";ctx.fillText(signalMarker.direction,sx,signalMarker.direction==="COMPRAR"?sy+31:sy-24);}}
 ctx.fillStyle="#8fa3b9";ctx.textAlign="left";const tfLabel=chartGranularity===30?"30s":chartGranularity===3600?"H1":chartGranularity===14400?"H4":"M"+(chartGranularity/60);ctx.fillText((candleStyle==="heikin"?"HEIKIN ASHI":"VELAS NORMALES")+" · "+tfLabel+" · "+data.length+" velas",left,h-7);ctx.textAlign="right";ctx.fillText(new Date(data[data.length-1].time*1000).toLocaleTimeString("es-PA",{hour:"2-digit",minute:"2-digit"}),w-right,h-7);{const remain=chartGranularity-(Math.floor(Date.now()/1000)%chartGranularity);const mm=String(Math.floor(remain/60)).padStart(2,"0"),ss=String(remain%60).padStart(2,"0");ctx.textAlign="left";ctx.font="bold 11px Arial";ctx.fillStyle="#ffd166";ctx.fillText("CIERRE "+tfLabel+" "+mm+":"+ss,left+4,top+13);}
}
function setCandleStyle(style){candleStyle=style==="normal"?"normal":"heikin";drawMarketChart();}
window.addEventListener("resize",resizeMarketChart);
setInterval(()=>{if(candleData.length)drawMarketChart();},1000);
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",createMarketChart);else createMarketChart();

document.addEventListener("DOMContentLoaded",()=>{[9,20,50].forEach(p=>{const el=document.getElementById("show-ema"+p);if(el)el.addEventListener("change",()=>drawMarketChart());});});
