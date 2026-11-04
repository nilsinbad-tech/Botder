let candleData=[],chartSymbol=null,tradeLevels=[],signalMarker=null,chartCanvas=null,chartContext=null,resizeObserver=null,candleStyle="normal";
let liveVisualPrice=null,liveFromPrice=null,liveToPrice=null,liveAnimationStart=0,liveAnimationFrame=null;
let backtestTradeData=[];let structureOverlay={items:[],projection:null};window.botderObVisibility={60:true,120:true,300:true,600:true,900:true,1800:true,3600:true,14400:true};let liveChartPrice=null;
let viewEnd=0,viewCount=180,followLive=true,dragX=null,dragEnd=0,activePointers=new Map(),pinchStart=0,pinchCount=100,pinchAnchorIndex=0,pinchAnchorRatio=.5,chartFrame=null,scaleMin=null,scaleMax=null,scaleWindow="",chartGranularity=60;let lastPanDelta=0,lastPanAt=0,panMomentumFrame=null;const futureSpace=40;let drawingMode="pan",userDrawings=[],pendingDrawing=null,priceScaleDrag=null,verticalPanDrag=null,chartPlot={left:10,right:66,top:16,bottom:25,step:1,start:0};
function createMarketChart(containerId="chart-area"){
 const host=document.getElementById(containerId);if(!host)return false;
 // Evita crear un segundo canvas sobre el primero: app.js y este archivo podían inicializar el mismo gráfico.
 if(chartCanvas&&chartCanvas.isConnected&&chartCanvas.parentElement===host&&chartContext)return true;
 host.innerHTML="";chartCanvas=document.createElement("canvas");
 chartCanvas.style.cssText="position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;cursor:grab";
 host.appendChild(chartCanvas);const tools=document.createElement("div");tools.style.cssText="position:absolute;z-index:5;top:8px;right:72px;left:auto;display:flex;gap:3px;flex-wrap:wrap;justify-content:flex-end;max-width:calc(100% - 86px)";[["pan","MOVER"],["line","LÍNEA"],["zone","ZONA"],["clear","BORRAR"]].forEach(([mode,label])=>{const b=document.createElement("button");b.type="button";b.textContent=label;b.style.cssText="border:1px solid #48617e;border-radius:6px;background:#101d2d;color:#e8f0fa;padding:4px 6px;font-size:8px;font-weight:700";b.addEventListener("click",()=>{if(mode==="clear"){userDrawings=[];pendingDrawing=null;}else drawingMode=mode;tools.querySelectorAll("button").forEach(x=>x.style.background=x===b?"#245b78":"#101d2d");drawMarketChart();});tools.appendChild(b);});[["zoom-in","+"],["zoom-out","−"],["zoom-y-in","Y+"],["zoom-y-out","Y−"],["reset-view","AJUSTAR"]].forEach(([action,label])=>{const b=document.createElement("button");b.type="button";b.textContent=label;b.title=action==="zoom-in"?"Acercar":action==="zoom-out"?"Alejar":"Volver a vista actual";b.style.cssText="border:1px solid #48617e;border-radius:6px;background:#101d2d;color:#e8f0fa;padding:4px 6px;font-size:8px;font-weight:700";b.addEventListener("click",()=>{if(action==="reset-view"){viewCount=1000;viewEnd=candleData.length+futureSpace;followLive=true;scaleMin=null;scaleMax=null;scaleWindow="";}else if(action==="zoom-y-in"||action==="zoom-y-out"){if(Number.isFinite(scaleMin)&&Number.isFinite(scaleMax)){const mid=(scaleMin+scaleMax)/2,factor=action==="zoom-y-in"?.78:1.28,half=(scaleMax-scaleMin)*factor/2;scaleMin=mid-half;scaleMax=mid+half;scaleWindow="manual-pan";}}else{const ratio=.5,end=Math.max(0,Math.min(candleData.length+viewCount-1,viewEnd||candleData.length+futureSpace)),start=Math.max(0,end-viewCount),anchor=start+ratio*viewCount;viewCount=Math.max(15,Math.min(5000,Math.round(viewCount*(action==="zoom-in"?.75:1.33))));viewEnd=Math.max(Math.min(viewCount,candleData.length),Math.min(candleData.length+viewCount-1,Math.round(anchor+(1-ratio)*viewCount)));followLive=false;}drawMarketChart();});tools.appendChild(b);});host.appendChild(tools);tools.style.position="absolute";tools.style.top="8px";tools.style.left="8px";tools.style.right="72px";tools.style.zIndex="12";tools.style.maxWidth="calc(100% - 84px)";tools.style.justifyContent="flex-start";
 const fullBtn=document.createElement("button");fullBtn.type="button";fullBtn.className="chart-fullscreen-btn";fullBtn.textContent="⛶";fullBtn.title="Pantalla completa";fullBtn.setAttribute("aria-label","Activar pantalla completa");
 fullBtn.addEventListener("click",async()=>{try{if(document.fullscreenElement===host){await document.exitFullscreen();}else if(host.requestFullscreen){await host.requestFullscreen();}else if(host.webkitRequestFullscreen){host.webkitRequestFullscreen();}else{host.classList.toggle("chart-fullscreen-fallback");} }catch(_){host.classList.toggle("chart-fullscreen-fallback");} });
 host.appendChild(fullBtn);
 if(!window.botderFullscreenListener){window.botderFullscreenListener=true;document.addEventListener("fullscreenchange",()=>{const active=document.fullscreenElement===host;fullBtn.textContent=active?"⤢":"⛶";fullBtn.title=active?"Salir de pantalla completa":"Pantalla completa";fullBtn.setAttribute("aria-label",active?"Salir de pantalla completa":"Activar pantalla completa");requestAnimationFrame(resizeMarketChart);});}

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
function setChartSymbol(s){chartSymbol=s;liveChartPrice=null;candleData=[];tradeLevels=[];signalMarker=null;structureOverlay={items:[],lines:[],projection:null};followLive=true;viewEnd=0;viewCount=180;userDrawings=[];pendingDrawing=null;scaleMin=null;scaleMax=null;scaleWindow="";drawMarketChart();}
function setLiveChartPrice(price){const v=Number(price);if(!Number.isFinite(v))return;const now=performance.now();liveFromPrice=Number.isFinite(liveVisualPrice)?liveVisualPrice:(Number.isFinite(liveChartPrice)?liveChartPrice:v);liveToPrice=v;liveAnimationStart=now;liveChartPrice=v;if(liveAnimationFrame===null){const animate=()=>{const t=Math.min(1,(performance.now()-liveAnimationStart)/650);const eased=1-Math.pow(1-t,3);liveVisualPrice=liveFromPrice+(liveToPrice-liveFromPrice)*eased;drawMarketChart();if(t<1)liveAnimationFrame=requestAnimationFrame(animate);else{liveVisualPrice=liveToPrice;liveAnimationFrame=null;}};liveAnimationFrame=requestAnimationFrame(animate);}}
function setChartGranularity(seconds){const next=Number(seconds)||60;if(next!==chartGranularity){followLive=true;viewEnd=0;viewCount=Math.ceil(86400/next);}chartGranularity=next;scaleMin=null;scaleMax=null;scaleWindow="";drawMarketChart();}
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
function drawTradeLevels(signal,mark=true){if(!signal)return;tradeLevels=[];signalMarker={time:Number(signal.time)||candleData.at(-1)?.time||0,direction:String(signal.direction||"COMPRAR").toUpperCase()};drawMarketChart();}
function clearTradeLevels(){tradeLevels=[];signalMarker=null;drawMarketChart();}
function getActiveChartSymbol(){return chartSymbol;}
function drawMarketChart(){if(chartFrame!==null)return;chartFrame=requestAnimationFrame(()=>{chartFrame=null;renderMarketChart();});}
function renderMarketChart(){
 if(!chartCanvas||!chartContext)return;const ctx=chartContext,w=chartCanvas.parentElement?.clientWidth||0,h=chartCanvas.parentElement?.clientHeight||0;if(!w||!h)return;
 ctx.clearRect(0,0,w,h);ctx.fillStyle="#081321";ctx.fillRect(0,0,w,h);
 const left=10,right=66,top=16,bottom=25,pw=w-left-right,ph=h-top-bottom,chartTextScale=Math.max(1,Math.min(1.8,w/520)),lineScale=chartTextScale;
 ctx.font=(4.5*chartTextScale)+"px Arial";ctx.strokeStyle="#1c3047";ctx.lineWidth=.45;
 for(let i=0;i<=4;i++){let y=top+ph*i/4;ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(w-right,y);ctx.stroke();}
 if(!candleData.length){ctx.fillStyle="#8fa3b9";ctx.textAlign="center";ctx.font=(5.5*chartTextScale)+"px Arial";ctx.fillText("Esperando datos reales del mercado...",w/2,h/2);return;}
 const end=Math.max(0,Math.min(candleData.length+viewCount-1,viewEnd||candleData.length+futureSpace)),start=Math.max(0,end-viewCount),raw=candleStyle==="heikin"?toHeikinAshi(candleData):candleData,data=raw.slice(start,Math.min(end,candleData.length));
 // Suaviza visualmente el movimiento de la vela abierta entre ticks reales, sin modificar el OHLC guardado.
 if(data.length&&Number.isFinite(liveVisualPrice)&&data[data.length-1].time===candleData[candleData.length-1]?.time){const last=data[data.length-1];data[data.length-1]={...last,close:liveVisualPrice,high:Math.max(last.high,liveVisualPrice),low:Math.min(last.low,liveVisualPrice)};}
 if(!data.length)return;const windowKey=start+":"+end+":"+viewCount;let lows=data.map(c=>c.low),highs=data.map(c=>c.high);const visibleStart=data[0].time,visibleEnd=data[data.length-1].time;const candleMin=Math.min(...data.map(c=>c.low)),candleMax=Math.max(...data.map(c=>c.high)),candleSpan=Math.max(candleMax-candleMin,Math.abs(candleMax)*1e-8),scaleRelevant=v=>Number.isFinite(Number(v))&&Number(v)>=candleMin-candleSpan*.15&&Number(v)<=candleMax+candleSpan*.15;const visibleTrades=backtestTradeData.filter(t=>{const et=Number(t.entryTime)/1000,xt=Number(t.exitTime||Date.now())/1000;return (!t.symbol||!chartSymbol||t.symbol===chartSymbol)&&(!t.timeframeSeconds||Number(t.timeframeSeconds)===Number(chartGranularity))&&Number.isFinite(et)&&et<=visibleEnd&&xt>=visibleStart;});visibleTrades.forEach(t=>[t.entry,t.sl,t.tp1,t.tp2,t.price].filter(scaleRelevant).forEach(v=>{v=Number(v);lows.push(v);highs.push(v);}));if(Number.isFinite(liveChartPrice)){lows.push(liveChartPrice);highs.push(liveChartPrice);}tradeLevels.forEach(v=>{lows.push(v.value);highs.push(v.value);});
 const scaleItems=(structureOverlay.items||[]).filter(a=>Number.isFinite(a.price)&&a.time<=visibleEnd&&!(String(a.type).toLowerCase()==="ob"&&window.botderObVisibility?.[Number(a.tf)]===false)),scaleZones=new Map();scaleItems.filter(a=>a.type==="ob"||a.type==="fvg").forEach(a=>{const k=a.type+"|"+a.time+"|"+a.side;if(!scaleZones.has(k))scaleZones.set(k,[]);scaleZones.get(k).push(a);});const recentScaleZones=[...scaleZones.values()].filter(g=>g.length>=2&&g.some(v=>scaleRelevant(v.price))).sort((a,b)=>a[0].time-b[0].time).slice(-24).flat();const visibleAnnotationsForScale=scaleItems.filter(a=>a.time>=visibleStart&&a.type!=="ob"&&a.type!=="fvg").concat(recentScaleZones);visibleAnnotationsForScale.forEach(a=>{lows.push(a.price);highs.push(a.price);});const pp=structureOverlay.projection;if(pp){[pp.zoneLow,pp.zoneHigh,pp.entry,pp.tp1,pp.tp2,pp.sl].filter(scaleRelevant).forEach(v=>{lows.push(Number(v));highs.push(Number(v));});}const rawMin=Math.min(...lows),rawMax=Math.max(...highs);
 if(scaleMin===null||scaleMax===null||(scaleWindow!==windowKey&&scaleWindow!=="manual-pan")){const pad=(rawMax-rawMin)*.08||Math.abs(rawMax)*.0001||1;scaleMin=rawMin-pad;scaleMax=rawMax+pad;scaleWindow=windowKey;}else if(scaleWindow!=="manual-pan"){const span=scaleMax-scaleMin,pad=span*.08;if(rawMin<scaleMin+pad)scaleMin=rawMin-pad;if(rawMax>scaleMax-pad)scaleMax=rawMax+pad;}
 const min=scaleMin,max=scaleMax;
 const yOf=v=>top+(max-v)/(max-min)*ph;
 // Se ocultan los precios de escala del lateral derecho; el espacio sigue disponible para arrastrar y ajustar el zoom vertical.
 const step=pw/Math.max(1,viewCount),bw=Math.max(1.5,step*.72);
 data.forEach((c,i)=>{let x=left+step*(i+.5),color=c.close>=c.open?"#39e6a0":"#ff6579";ctx.strokeStyle=color;ctx.fillStyle=color;ctx.beginPath();ctx.moveTo(x,yOf(c.high));ctx.lineTo(x,yOf(c.low));ctx.stroke();let y1=yOf(Math.max(c.open,c.close)),y2=yOf(Math.min(c.open,c.close));ctx.fillRect(x-bw/2,y1,bw,Math.max(1,y2-y1));});
 // SMC overlays: pivots, liquidity, BOS/CHoCH, OB/FVG and projected zone.

 const tag=(txt,x,y,color)=>{if(!txt)return;ctx.font="4.5px Arial";ctx.textAlign="left";let tw=ctx.measureText(txt).width,tx=Math.max(left,Math.min(w-right-tw-8,x)),ty=Math.max(top+12,Math.min(h-bottom-2,y));ctx.fillStyle="rgba(8,13,22,.94)";ctx.fillRect(tx,ty-11,tw+8,15);ctx.fillStyle=color;ctx.fillText(txt,tx+4,ty);};
 const allAnnotations=(structureOverlay.items||[]).filter(a=>{const type=String(a.type||"").toLowerCase(),side=String(a.side||"").toUpperCase(),label=String(a.label||"").toUpperCase();return !["choch","sweep"].includes(type)&&!(type==="bos"&&(side==="BEAR"||label.includes("BEAR")))&&Number.isFinite(a.price)&&a.time<=visibleEnd&&!(type==="ob"&&window.botderObVisibility?.[Number(a.tf)]===false);});const visibleAnnotations=allAnnotations.filter(a=>a.time>=visibleStart);
 const recent=(type,n,side)=>visibleAnnotations.filter(a=>a.type===type&&(!side||a.side===side)).sort((a,b)=>a.time-b.time);
 const annotations=[
  ...(()=>{const pools=visibleAnnotations.filter(a=>a.type==="liquidity"),chosen=[];for(const side of ["BSL","SSL"]){const candidates=pools.filter(a=>String(a.label).includes(side)).sort((a,b)=>b.time-a.time);const levels=[];for(const p of candidates){if(levels.every(q=>Math.abs(q.price-p.price)>Math.max(Math.abs(p.price)*0.00005,1e-8)))levels.push(p);if(levels.length>=5)break;}chosen.push(...levels);}return chosen;})(),
  ...recent("bos",2).filter(a=>a.side==="BULL"),...visibleAnnotations.filter(a=>a.type==="signal"),
  ...(()=>{const a=allAnnotations.filter(v=>v.type==="ob"&&v.time<=visibleEnd&&scaleRelevant(v.price)).sort((u,v)=>v.time-u.time),groups=new Map();a.forEach(v=>{if(!groups.has(v.time+"|"+v.side))groups.set(v.time+"|"+v.side,[]);groups.get(v.time+"|"+v.side).push(v);});const candidates=[...groups.values()].filter(g=>g.length>=2).map(g=>({items:g,hi:Math.max(...g.map(v=>v.price)),lo:Math.min(...g.map(v=>v.price)),time:g[0].time,active:g.some(v=>v.active)})).sort((u,v)=>Number(v.active)-Number(u.active)||v.time-u.time),kept=[];for(const z of candidates){if(!z.active&&kept.some(k=>z.lo<=k.hi&&z.hi>=k.lo))continue;kept.push(z);if(kept.length>=8)break;}return kept.flatMap(z=>z.items);})()
 ];
 chartPlot={left,right,top,bottom,step,start};
 const timeIndex=time=>{const first=candleData[0];return first?(Number(time)-first.time)/Math.max(1,chartGranularity):0;};
 const xAt=time=>left+(timeIndex(time)-start+.5)*step;
 (structureOverlay.lines||[]).forEach(line=>{if(![line.time1,line.time2,line.price1,line.price2].every(Number.isFinite))return;const i1=timeIndex(line.time1),i2=timeIndex(line.time2),slope=(line.price2-line.price1)/Math.max(1,i2-i1);if(i1>start+viewCount)return;const drawStart=Math.max(start,i1),priceStart=line.price1+slope*(drawStart-i1),x1=left+(drawStart-start+.5)*step,x2=left+viewCount*step,priceEnd=line.price2+slope*(start+viewCount-i2),y1=yOf(priceStart),y2=yOf(priceEnd),color=line.side==="BUY"?"#39e6a0":"#ff6878";ctx.save();ctx.strokeStyle=color;ctx.lineWidth=(line.primary?1.35:.9)*lineScale;ctx.globalAlpha=line.primary?.98:.72;ctx.setLineDash(line.primary?[]:[5,4]);ctx.beginPath();ctx.moveTo(Math.max(left,x1),y1);ctx.lineTo(Math.min(w-right,x2),y2);ctx.stroke();ctx.setLineDash([]);if(line.label){ctx.font="bold "+(4.5*chartTextScale)+"px Arial";ctx.fillStyle=color;ctx.textAlign="left";ctx.fillText(line.label,Math.max(left,Math.min(w-right-110,x2-100)),Math.max(top+10,Math.min(h-bottom-5,y2-5)));}(line.touches||[]).forEach((t,n)=>{const ix=timeIndex(t.time),tx=left+(ix-start+.5)*step,ty=yOf(t.price);if(tx<left||tx>w-right)return;ctx.fillStyle=color;ctx.beginPath();ctx.arc(tx,ty,3.2*lineScale,0,Math.PI*2);ctx.fill();ctx.font="bold 4.5px Arial";ctx.textAlign="center";if(line.primary){ctx.fillText(String(t.n||n+1),tx,ty-7);}});if(line.primary&&(line.touches||[]).length===2&&Number.isFinite(line.projectTime)){const ix=timeIndex(line.projectTime),tx=left+(ix-start+.5)*step,price=line.price2+slope*(ix-i2),ty=yOf(price);if(tx>=left&&tx<=w-right){ctx.strokeStyle="#ffd166";ctx.fillStyle="#0b1726";ctx.lineWidth=.85*lineScale;ctx.beginPath();ctx.arc(tx,ty,5,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.font="bold 4.5px Arial";ctx.fillStyle="#ffd166";ctx.textAlign="center";ctx.fillText("3º PREVISTO",tx,ty-9);}}ctx.restore();});
 const zoneGroups=new Map();
 annotations.filter(a=>a.type==="ob"||a.type==="fvg").forEach(a=>{const key=[a.type,a.time,a.side].join("|");if(!zoneGroups.has(key))zoneGroups.set(key,[]);zoneGroups.get(key).push(a);});
  zoneGroups.forEach((items,key)=>{
   if(items.length<2)return;
   const [type,,side]=key.split("|"),vals=items.map(v=>v.price),rawTop=yOf(Math.max(...vals)),rawBottom=yOf(Math.min(...vals)),x=xAt(items[0].time),color=type==="ob"?(side==="BUY"?"#39e6a0":"#ff6579"):(side==="BUY"?"#61b7ff":"#bd8cff"),active=type==="ob"&&items.some(v=>v.active);
   const zoneWidth=Math.max(4,Math.min(w-right-left,step*3)),zoneX=x;
   const zoneHeight=Math.max(4,rawBottom-rawTop),zoneTop=rawTop;
   ctx.fillStyle=color+(type==="ob"?(active?"48":"20"):"12");ctx.fillRect(zoneX,zoneTop,zoneWidth,zoneHeight);
   if(type==="ob"){
    ctx.strokeStyle=color;ctx.lineWidth=(active?1.6:1.05)*lineScale;ctx.strokeRect(zoneX,zoneTop,zoneWidth,zoneHeight);
    const obLabel=items.find(v=>v.label)?.label||(side==="BUY"?"OB ALCISTA":"OB BAJISTA");
    if(zoneHeight>9)tag(obLabel.replace(" · A FAVOR","").replace(" · EN CONTRA",""),zoneX+4,Math.max(top+12,zoneTop+12),color);

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
  if(a.type==="signal"){ctx.fillStyle=color;ctx.beginPath();ctx.arc(x,y,5*lineScale,0,Math.PI*2);ctx.fill();tag(a.label==="COMPRAR"?"BUY":"SELL",x+4,y-5,color);return;}ctx.strokeStyle=color;ctx.lineWidth=a.type==="liquidity"?.8:.7;ctx.setLineDash(a.type==="liquidity"?[4,4]:[2,3]);ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(Math.min(w-right,x+Math.max(12,step*4)),y);ctx.stroke();ctx.setLineDash([]);
  tag(a.type==="liquidity"?(a.label.includes("BSL")?"BSL":"SSL"):a.label,x+3,y-3,color);
 });
 const p=structureOverlay.projection;if(p&&Number.isFinite(p.zoneLow)&&Number.isFinite(p.zoneHigh)&&Number.isFinite(p.projectTime)){const buy=p.direction==="COMPRAR",col=buy?"#39e6a0":"#ff6579",ix=timeIndex(p.projectTime),x1=left+(ix-start+.5)*step,boxW=Math.max(4,step*3),x2=Math.min(w-right,x1+boxW),yt=yOf(p.zoneHigh),yb=yOf(p.zoneLow);if(x1>=left&&x1<=w-right&&x2>left){ctx.save();ctx.fillStyle=buy?"rgba(57,230,160,.17)":"rgba(255,101,121,.17)";ctx.strokeStyle=col;ctx.lineWidth=.9*lineScale;ctx.fillRect(Math.max(left,x1),yt,Math.max(4,x2-Math.max(left,x1)),Math.max(4,yb-yt));ctx.strokeRect(Math.max(left,x1),yt,Math.max(4,x2-Math.max(left,x1)),Math.max(4,yb-yt));ctx.setLineDash([4,3]);[[p.entry,"ENTRADA",col]].forEach(([v,label,color])=>{if(!Number.isFinite(Number(v)))return;const y=yOf(Number(v));ctx.strokeStyle=color;ctx.lineWidth=1*lineScale;ctx.beginPath();ctx.moveTo(Math.max(left,x1),y);ctx.lineTo(x2,y);ctx.stroke();ctx.setLineDash([]);const text=label+" "+Number(v).toPrecision(7);ctx.font="bold 4.5px Arial";ctx.textAlign="left";const tw=ctx.measureText(text).width,bx=Math.min(w-right-tw-10,Math.max(left,x1)+2),by=Math.max(top+12,Math.min(h-bottom-3,y-3));ctx.fillStyle="rgba(0,0,0,.96)";ctx.fillRect(bx,by-9,tw+7,12);ctx.strokeStyle=color;ctx.lineWidth=.45;ctx.strokeRect(bx,by-9,tw+7,12);ctx.fillStyle="#f8fafc";ctx.fillText(text,bx+3,by);ctx.setLineDash([4,3]);});ctx.setLineDash([]);ctx.fillStyle=col;ctx.font="bold 4.5px Arial";ctx.textAlign="left";ctx.fillText((buy?"COMPRA · T3":"VENTA · T3"),Math.max(left,Math.min(w-right-125,x1+3)),Math.max(top+11,yt-7));ctx.restore();}}
 // Niveles de entrada, stop y objetivos: se dibujan siempre encima de las velas.
 const levelGroups=new Map();tradeLevels.forEach(v=>{const k=Number(v.value).toPrecision(12);if(!levelGroups.has(k))levelGroups.set(k,{...v,labels:[v.label]});else levelGroups.get(k).labels.push(v.label);});
 levelGroups.forEach(v=>{const rawY=yOf(v.value),outside=rawY<top||rawY>h-bottom,y=Math.max(top+2,Math.min(h-bottom-2,rawY));ctx.save();ctx.strokeStyle=v.color;ctx.lineWidth=.8*lineScale;ctx.setLineDash(v.labels.includes("SL")?[5,4]:[3,3]);ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(w-right,y);ctx.stroke();ctx.setLineDash([]);const txt=(outside?(rawY<top?"↑ ":"↓ "):"")+v.labels.join(" / ")+" "+Number(v.value).toPrecision(7);ctx.font="bold 4.5px Arial";const tw=ctx.measureText(txt).width;ctx.fillStyle="rgba(7,16,28,.96)";ctx.fillRect(left+3,Math.max(top,y-12),tw+9,13);ctx.fillStyle=v.color;ctx.textAlign="left";ctx.fillText(txt,left+7,Math.max(top+9,Math.min(h-bottom-3,y-3)));ctx.restore();});
 // Línea y etiqueta persistentes del último tick. Si se navega por el histórico y el precio queda fuera de escala, se fija un indicador en el borde visible.
 if(Number.isFinite(liveChartPrice)){const outside=liveChartPrice>max||liveChartPrice<min,py=Math.max(top+2,Math.min(h-bottom-2,yOf(liveChartPrice))),priceText=liveChartPrice.toFixed( Math.max(2,Math.min(8,Math.max(0,(String(liveChartPrice).split(".")[1]||"").length))) );ctx.save();ctx.strokeStyle="#ffd166";ctx.lineWidth=.6;ctx.setLineDash(outside?[2,3]:[4,3]);ctx.beginPath();ctx.moveTo(left,py);ctx.lineTo(w-right,py);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle="#ffd166";ctx.fillRect(w-right+1,py-12,right-2,24);ctx.fillStyle="#081321";ctx.font="bold 5px Arial";ctx.textAlign="left";ctx.fillText((outside?(liveChartPrice>max?"↑ ":"↓ "):"")+priceText,w-right+4,py+4);ctx.fillStyle="#ffd166";ctx.font="bold 4.5px Arial";ctx.textAlign="left";ctx.fillText("PRECIO ACTUAL",left+5,Math.max(top+12,Math.min(h-bottom-5,py-7)));ctx.beginPath();ctx.fillStyle="#ffd166";ctx.arc(w-right-3,py,3,0,Math.PI*2);ctx.fill();ctx.restore();}
 // Backtest visual: cuerpo verde/rojo limitado desde la vela de entrada hasta la vela de cierre.
 visibleTrades.filter(t=>(!t.symbol||!chartSymbol||t.symbol===chartSymbol)&&(!t.timeframeSeconds||Number(t.timeframeSeconds)===Number(chartGranularity))).forEach(t=>{
  const et=Number(t.entryTime)/1000;if(!Number.isFinite(et))return;
  const xIndex=time=>timeIndex(time),ei=xIndex(et),xi=Number(t.exitTime)>0?xIndex(Number(t.exitTime)/1000):Math.min(start+data.length-1,start+viewCount-1);
  if(ei>start+viewCount||xi<start||ei>xi)return;
  const x1=Math.max(left,left+(ei-start+.5)*step),x2=Math.min(w-right,left+(xi-start+.5)*step+Math.max(1,step*.35));
  if(x2<=x1)return;
  const entry=Number(t.entry),sl=Number(t.sl),tp=Number(t.tp2||t.tp1);
  if(![entry,sl,tp].every(Number.isFinite))return;
  const ye=yOf(entry),ys=yOf(sl),yt=yOf(tp),greenTop=Math.min(ye,yt),greenBottom=Math.max(ye,yt),redTop=Math.min(ye,ys),redBottom=Math.max(ye,ys);
  const done=t.result==="GANADA"||t.result==="PERDIDA",active=t.result==="ABIERTA"||!done;
  const green=t.result==="PERDIDA"?"#39e6a0":"#39e6a0",red="#ff6579";
  ctx.save();ctx.beginPath();ctx.rect(left,top,pw,ph);ctx.clip();ctx.globalAlpha=active?.13:.19;ctx.fillStyle=green;ctx.fillRect(x1,greenTop,Math.max(1,x2-x1),Math.max(1,greenBottom-greenTop));ctx.fillStyle=red;ctx.fillRect(x1,redTop,Math.max(1,x2-x1),Math.max(1,redBottom-redTop));
  ctx.globalAlpha=.72;ctx.strokeStyle=green;ctx.lineWidth=.65;ctx.strokeRect(x1,greenTop,Math.max(1,x2-x1),Math.max(1,greenBottom-greenTop));ctx.strokeStyle=red;ctx.strokeRect(x1,redTop,Math.max(1,x2-x1),Math.max(1,redBottom-redTop));
  ctx.globalAlpha=.95;ctx.strokeStyle="#e8edf5";ctx.setLineDash([2,2]);ctx.beginPath();ctx.moveTo(x1,ye);ctx.lineTo(x2,ye);ctx.stroke();ctx.setLineDash([]);
  const color=active?"#ffd166":t.result==="GANADA"?"#39e6a0":"#ff6579";ctx.fillStyle=color;ctx.beginPath();ctx.arc(x1,ye,2.8,0,Math.PI*2);ctx.fill();
  ctx.font="bold 4.5px Arial";ctx.textAlign="left";ctx.fillText(active?"EN CURSO":(t.exitReason||t.result),Math.min(w-right-45,x2+2),Math.max(top+8,Math.min(h-bottom-4,ye-3)));
  ctx.restore();
 });

 // Canales y puntos de la estructura guardados en cada operación del backtest.
 visibleTrades.forEach(t=>{
  (t.structureLines||[]).forEach(line=>{
   if(![line.time1,line.time2,line.price1,line.price2].every(Number.isFinite))return;
   const i1=timeIndex(line.time1),i2=timeIndex(line.time2),slope=(line.price2-line.price1)/Math.max(1,i2-i1);
   const endTime=Number(t.exitTime||visibleEnd)/1000,limit=Math.min(endTime,visibleEnd),endIndex=timeIndex(limit);
   const fromIndex=Math.max(start,i1),toIndex=Math.min(endIndex,start+viewCount);
   if(toIndex<fromIndex)return;
   const x1=left+(fromIndex-start+.5)*step,x2=left+(toIndex-start+.5)*step;
   const y1=yOf(line.price1+slope*(fromIndex-i1)),y2=yOf(line.price1+slope*(toIndex-i1));
   ctx.save();ctx.strokeStyle=t.result==="GANADA"?"#39e6a0":t.result==="PERDIDA"?"#ff6579":"#8fa3b9";ctx.globalAlpha=.52;ctx.lineWidth=.6;ctx.setLineDash([4,4]);ctx.beginPath();ctx.moveTo(Math.max(left,x1),y1);ctx.lineTo(Math.min(w-right,x2),y2);ctx.stroke();ctx.setLineDash([]);
   (line.touches||[]).forEach(p=>{const ix=timeIndex(p.time),px=left+(ix-start+.5)*step;if(px<left||px>w-right||p.time>endTime)return;const py=yOf(p.price);ctx.fillStyle=t.result==="GANADA"?"#39e6a0":t.result==="PERDIDA"?"#ff6579":"#8fa3b9";ctx.beginPath();ctx.arc(px,py,2,0,Math.PI*2);ctx.fill();});
   ctx.restore();
  });
 });
 // Historial: marcas pequeñas en la vela exacta de entrada y salida.
 visibleTrades.filter(t=>!t.symbol||!chartSymbol||t.symbol===chartSymbol).forEach(t=>{
  const entryTime=Number(t.entryTime)/1000,exitTime=Number(t.exitTime||0)/1000;if(!Number.isFinite(entryTime))return;
  const findX=time=>{let best=-1,delta=Infinity;for(let k=0;k<data.length;k++){const d=Math.abs(data[k].time-time);if(d<delta){delta=d;best=k;}}return delta<=chartGranularity*1.5?best:-1;};
  const ix=findX(entryTime);
  if(ix>=0){const c=data[ix],x=left+step*(ix+.5),y=yOf(t.direction==="COMPRAR"?c.low:c.high),color=t.result==="ABIERTA"?"#ffd166":t.result==="GANADA"?"#39e6a0":t.result==="PERDIDA"?"#ff6579":"#8fa3b9";
   ctx.save();ctx.fillStyle=color;ctx.strokeStyle="#081321";ctx.lineWidth=1;ctx.beginPath();ctx.arc(x,y,3.2,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.font="bold 4.5px Arial";ctx.textAlign="center";ctx.fillStyle=color;ctx.fillText(t.result==="ABIERTA"?"ACTIVA":t.direction==="COMPRAR"?"C":"V",x,Math.max(top+9,Math.min(h-bottom-8,y+(t.direction==="COMPRAR"?12:-7))));ctx.restore();}
  if(exitTime>0&&Number.isFinite(Number(t.exitPrice))){const ex=findX(exitTime);if(ex>=0){const x=left+step*(ex+.5),y=yOf(Number(t.exitPrice)),color=t.result==="GANADA"?"#39e6a0":"#ff6579";ctx.save();ctx.fillStyle=color;ctx.fillRect(x-2,y-2,4,4);ctx.font="bold 4px Arial";ctx.textAlign="center";ctx.fillText(t.exitReason||"CIERRE",x,Math.max(top+8,Math.min(h-bottom-5,y-5)));ctx.restore();}}
 });
const drawUserShape=d=>{const y1=yOf(d.p1??d.price),y2=yOf(d.p2??d.price);if(d.type==="line"){ctx.strokeStyle="#f4c45e";ctx.lineWidth=.55;ctx.setLineDash([6,4]);ctx.beginPath();ctx.moveTo(left,y1);ctx.lineTo(w-right,y1);ctx.stroke();ctx.setLineDash([]);tag("NIVEL",left+5,y1-5,"#f4c45e");}else{const x1=left+(Math.min(d.x1,d.x2)-start+.5)*step,x2=left+(Math.max(d.x1,d.x2)-start+.5)*step,yt=Math.min(y1,y2),yb=Math.max(y1,y2);ctx.fillStyle="rgba(72,168,255,.13)";ctx.fillRect(x1,yt,Math.max(3,x2-x1),Math.max(3,yb-yt));ctx.strokeStyle="#61b7ff";ctx.lineWidth=.455;ctx.strokeRect(x1,yt,Math.max(3,x2-x1),Math.max(3,yb-yt));}};userDrawings.forEach(drawUserShape);if(pendingDrawing)drawUserShape(pendingDrawing);  if(signalMarker){const si=data.findIndex(v=>v.time===signalMarker.time);if(si>=0){const candle=data[si],sx=left+step*(si+.5),sy=yOf(signalMarker.direction==="COMPRAR"?candle.low:candle.high);ctx.fillStyle=signalMarker.direction==="COMPRAR"?"#39e6a0":"#ff6579";ctx.beginPath();if(signalMarker.direction==="COMPRAR"){ctx.moveTo(sx,sy+10);ctx.lineTo(sx-6,sy+20);ctx.lineTo(sx+6,sy+20);}else{ctx.moveTo(sx,sy-10);ctx.lineTo(sx-6,sy-20);ctx.lineTo(sx+6,sy-20);}ctx.closePath();ctx.fill();ctx.font="bold 4.5px Arial";ctx.textAlign="center";ctx.fillText(signalMarker.direction,sx,signalMarker.direction==="COMPRAR"?sy+31:sy-24);}}
 ctx.fillStyle="#8fa3b9";ctx.textAlign="left";const tfLabel=chartGranularity===30?"30s":chartGranularity===3600?"H1":chartGranularity===14400?"H4":"M"+(chartGranularity/60);ctx.fillText((candleStyle==="heikin"?"HEIKIN ASHI":"VELAS NORMALES")+" · "+tfLabel+" · "+data.length+" velas",left,h-7);ctx.textAlign="right";ctx.fillText(new Date(data[data.length-1].time*1000).toLocaleTimeString("es-PA",{hour:"2-digit",minute:"2-digit"}),w-right,h-7);{const remain=chartGranularity-(Math.floor(Date.now()/1000)%chartGranularity);const mm=String(Math.floor(remain/60)).padStart(2,"0"),ss=String(remain%60).padStart(2,"0");ctx.textAlign="left";ctx.font="bold 5px Arial";ctx.fillStyle="#ffd166";ctx.fillText("CIERRE "+tfLabel+" "+mm+":"+ss,left+4,top+13);}
}
function setCandleStyle(style){candleStyle=style==="normal"?"normal":"heikin";drawMarketChart();}
window.addEventListener("resize",resizeMarketChart);
setInterval(()=>{if(candleData.length)drawMarketChart();},1000);
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",createMarketChart);else createMarketChart();

document.addEventListener("DOMContentLoaded",()=>{[9,20,50].forEach(p=>{const el=document.getElementById("show-ema"+p);if(el)el.addEventListener("change",()=>drawMarketChart());});});

document.addEventListener("DOMContentLoaded",()=>{
 document.querySelectorAll(".ob-toggle").forEach(button=>{
  const tf=Number(button.dataset.obTf);
  button.classList.toggle("active",window.botderObVisibility[tf]!==false);
  button.setAttribute("aria-pressed",String(window.botderObVisibility[tf]!==false));
  button.addEventListener("click",()=>{
   const show=window.botderObVisibility[tf]===false;
   window.botderObVisibility[tf]=show;
   button.classList.toggle("active",show);
   button.setAttribute("aria-pressed",String(show));
   drawMarketChart();
  });
 });
});
