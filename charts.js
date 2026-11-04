let candleData=[],chartSymbol=null,tradeLevels=[],signalMarker=null,chartCanvas=null,chartContext=null,resizeObserver=null,candleStyle="normal";
let backtestTradeData=[];let structureOverlay={items:[],projection:null};
let viewEnd=0,viewCount=100,dragX=null,dragEnd=0,activePointers=new Map(),pinchStart=0,pinchCount=100,pinchAnchorIndex=0,pinchAnchorRatio=.5,chartFrame=null,scaleMin=null,scaleMax=null,scaleWindow="",chartGranularity=60;
function createMarketChart(containerId="chart-area"){
 const host=document.getElementById(containerId);if(!host)return false;
 host.innerHTML="";chartCanvas=document.createElement("canvas");
 chartCanvas.style.cssText="position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;cursor:grab";
 host.appendChild(chartCanvas);
 chartContext=chartCanvas.getContext("2d");if(!chartContext)return false;
 if(resizeObserver)resizeObserver.disconnect();resizeObserver=new ResizeObserver(resizeMarketChart);resizeObserver.observe(host);
 chartCanvas.addEventListener("pointerdown",e=>{
  if(e.pointerType==="mouse"&&e.button!==0)return;
  activePointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
  try{chartCanvas.setPointerCapture(e.pointerId);}catch(_){}
  if(activePointers.size===1){
   dragX=e.clientX;
   dragEnd=Math.max(0,Math.min(candleData.length,viewEnd||candleData.length));
   viewEnd=dragEnd;
   chartCanvas.style.cursor="grabbing";
  }else if(activePointers.size===2){
   const p=[...activePointers.values()];
   pinchStart=Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y);
   pinchCount=viewCount;
   const rect=chartCanvas.getBoundingClientRect(),mid=(p[0].x+p[1].x)/2;
   pinchAnchorRatio=Math.max(0,Math.min(1,(mid-rect.left-10)/Math.max(1,rect.width-76)));
   const end=Math.max(0,Math.min(candleData.length,viewEnd||candleData.length));
   const visibleCount=Math.min(viewCount,end);
   pinchAnchorIndex=Math.max(0,end-visibleCount)+pinchAnchorRatio*visibleCount;
   dragX=null;
  }
 });
 chartCanvas.addEventListener("pointermove",e=>{
  if(!activePointers.has(e.pointerId))return;
  const previous=activePointers.get(e.pointerId);
  activePointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(activePointers.size>=2){
   const p=[...activePointers.values()],dist=Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y);
   if(pinchStart>0){
    viewCount=Math.max(15,Math.min(5000,Math.round(pinchCount*pinchStart/Math.max(1,dist))));
    const visible=Math.min(viewCount,candleData.length);
    viewEnd=Math.max(visible,Math.min(candleData.length,Math.round(pinchAnchorIndex+(1-pinchAnchorRatio)*visible)));
   }
   drawMarketChart();return;
  }
  if(dragX===null)return;
  const step=(chartCanvas.parentElement.clientWidth-76)/Math.max(1,Math.min(viewCount,candleData.length));
  const shift=Math.round((dragX-e.clientX)/Math.max(1,step));
  viewEnd=Math.max(Math.min(viewCount,candleData.length),Math.min(candleData.length,dragEnd+shift));
  drawMarketChart();
 });
 const endDrag=e=>{
  activePointers.delete(e.pointerId);
  if(activePointers.size<2)pinchStart=0;
  if(activePointers.size===1){
   const p=[...activePointers.values()][0];dragX=p.x;dragEnd=viewEnd;
  }else{dragX=null;chartCanvas.style.cursor="grab";}
 };
 chartCanvas.addEventListener("pointerup",endDrag);
 chartCanvas.addEventListener("pointercancel",endDrag);
 chartCanvas.addEventListener("lostpointercapture",endDrag);
 chartCanvas.addEventListener("wheel",e=>{e.preventDefault();const rect=chartCanvas.getBoundingClientRect(),ratio=Math.max(0,Math.min(1,(e.clientX-rect.left-10)/Math.max(1,rect.width-76))),end=Math.max(0,Math.min(candleData.length,viewEnd||candleData.length)),oldCount=Math.min(viewCount,end),anchor=Math.max(0,end-oldCount)+ratio*oldCount;viewCount=Math.max(15,Math.min(5000,Math.round(viewCount*(e.deltaY>0?1.2:.82))));const next=Math.min(viewCount,candleData.length);viewEnd=Math.max(next,Math.min(candleData.length,Math.round(anchor+(1-ratio)*next)));drawMarketChart();},{passive:false});
 resizeMarketChart();drawMarketChart();return true;
}
function resizeMarketChart(){if(!chartCanvas||!chartContext)return;const host=chartCanvas.parentElement;if(!host)return;const r=host.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2);chartCanvas.width=Math.max(1,Math.floor(r.width*dpr));chartCanvas.height=Math.max(1,Math.floor(r.height*dpr));chartContext.setTransform(dpr,0,0,dpr,0,0);drawMarketChart();}
function setChartSymbol(s){chartSymbol=s;candleData=[];tradeLevels=[];signalMarker=null;viewEnd=0;viewCount=100;scaleMin=null;scaleMax=null;scaleWindow="";drawMarketChart();}
function setChartGranularity(seconds){chartGranularity=Number(seconds)||60;scaleMin=null;scaleMax=null;scaleWindow="";drawMarketChart();}
function updateCandles(c){if(!Array.isArray(c))return;const oldLength=candleData.length,wasFollowing=viewEnd===0||viewEnd>=oldLength,distanceFromEnd=Math.max(0,oldLength-viewEnd);candleData=c.filter(x=>[x.time,x.open,x.high,x.low,x.close].every(Number.isFinite)).sort((a,b)=>a.time-b.time).slice();viewEnd=wasFollowing?candleData.length:Math.max(Math.min(viewCount,candleData.length),candleData.length-distanceFromEnd);scaleMin=null;scaleMax=null;scaleWindow="";drawMarketChart();}
function addCandle(c){if(!c||![c.time,c.open,c.high,c.low,c.close].every(Number.isFinite))return;const following=viewEnd>=candleData.length;const last=candleData[candleData.length-1];if(last&&last.time===c.time)candleData[candleData.length-1]=c;else{candleData.push(c);}if(following)viewEnd=candleData.length;else viewEnd=Math.min(viewEnd,candleData.length);drawMarketChart();}
function setBacktestTrades(trades){backtestTradeData=Array.isArray(trades)?trades.slice():[];drawMarketChart();}
function setStructureOverlay(data){structureOverlay=data||{items:[],projection:null};drawMarketChart();}
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
function drawTradeLevels(signal){if(!signal)return;tradeLevels=[{value:Number(signal.entry),label:"ENTRADA",color:"#48a8ff"},{value:Number(signal.sl),label:"SL",color:"#ff5364"},{value:Number(signal.tp1),label:"TP1",color:"#f5c451"},{value:Number(signal.tp2),label:"TP2",color:"#20c997"}].filter(x=>Number.isFinite(x.value));signalMarker={time:Number(signal.time),direction:signal.direction};drawMarketChart();}
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
 const end=Math.max(0,Math.min(candleData.length,viewEnd||candleData.length)),start=Math.max(0,end-viewCount),raw=candleData.slice(0,end),data=(candleStyle==="heikin"?toHeikinAshi(raw):raw).slice(start,end);
 if(!data.length)return;const windowKey=start+":"+end+":"+viewCount;let lows=data.map(c=>c.low),highs=data.map(c=>c.high);const visibleStart=data[0].time,visibleEnd=data[data.length-1].time;const visibleTrades=backtestTradeData.filter(t=>{const et=Number(t.entryTime)/1000,xt=Number(t.exitTime||Date.now())/1000;return Number.isFinite(et)&&et<=visibleEnd&&xt>=visibleStart;});visibleTrades.forEach(t=>[t.entry,t.sl,t.tp1,t.tp2,t.price].forEach(v=>{v=Number(v);if(Number.isFinite(v)){lows.push(v);highs.push(v);}}));const candleMin=Math.min(...data.map(c=>c.low)),candleMax=Math.max(...data.map(c=>c.high));tradeLevels.forEach(x=>{if(Number.isFinite(x.value)&&x.value>=candleMin-(candleMax-candleMin)*.25&&x.value<=candleMax+(candleMax-candleMin)*.25){lows.push(x.value);highs.push(x.value);}});
 const scaleItems=(structureOverlay.items||[]).filter(a=>Number.isFinite(a.price)&&a.time<=visibleEnd),scaleZones=new Map();scaleItems.filter(a=>a.type==="ob"||a.type==="fvg").forEach(a=>{const k=a.type+"|"+a.time+"|"+a.side;if(!scaleZones.has(k))scaleZones.set(k,[]);scaleZones.get(k).push(a);});const scaleZoneGroups=[...scaleZones.values()].filter(g=>g.length>=2).sort((a,b)=>a[0].time-b[0].time),recentScaleZones=[...scaleZoneGroups.filter(g=>g[0].type==="fvg").slice(-8),...["BUY","SELL"].flatMap(side=>scaleZoneGroups.filter(g=>g[0].type==="ob"&&g[0].side===side).slice(-2))].flat();const visibleAnnotationsForScale=scaleItems.filter(a=>a.time>=visibleStart&&a.type!=="ob"&&a.type!=="fvg").concat(recentScaleZones);visibleAnnotationsForScale.forEach(a=>{lows.push(a.price);highs.push(a.price);});const rawMin=Math.min(...lows),rawMax=Math.max(...highs);
 if(scaleWindow!==windowKey||scaleMin===null||scaleMax===null){const pad=(rawMax-rawMin)*.08||Math.abs(rawMax)*.0001||1;scaleMin=rawMin-pad;scaleMax=rawMax+pad;scaleWindow=windowKey;}else{const span=scaleMax-scaleMin,pad=span*.08;if(rawMin<scaleMin+pad)scaleMin=rawMin-pad;if(rawMax>scaleMax-pad)scaleMax=rawMax+pad;}
 const candleSpan=candleMax-candleMin,scalePad=(candleSpan||Math.abs(candleMax)*.0001||1)*.18;
 const min=candleMin-scalePad,max=candleMax+scalePad;
 const yOf=v=>top+(max-v)/(max-min)*ph;
 for(let i=0;i<=4;i++){let v=max-(max-min)*i/4,y=top+ph*i/4;ctx.fillStyle="#8495aa";ctx.textAlign="left";ctx.fillText(v.toFixed(4),w-right+5,y+3);}
 const step=pw/Math.max(viewCount,data.length),bw=Math.max(2,Math.min(10,step*.65));
 data.forEach((c,i)=>{let x=left+step*(i+.5),color=c.close>=c.open?"#20c997":"#ff5364";ctx.strokeStyle=color;ctx.fillStyle=color;ctx.beginPath();ctx.moveTo(x,yOf(c.high));ctx.lineTo(x,yOf(c.low));ctx.stroke();let y1=yOf(Math.max(c.open,c.close)),y2=yOf(Math.min(c.open,c.close));ctx.fillRect(x-bw/2,y1,bw,Math.max(1,y2-y1));});
 // EMA overlays are visible; Bollinger stays internal and is never drawn.
 [9,20,50].forEach((period,n)=>{if(raw.length<period)return;let alpha=2/(period+1),v=raw.slice(0,period).reduce((s,c)=>s+c.close,0)/period,series=Array(raw.length).fill(null);series[period-1]=v;for(let k=period;k<raw.length;k++){v=raw[k].close*alpha+v*(1-alpha);series[k]=v;}ctx.beginPath();let begun=false;for(let k=start;k<end;k++){if(series[k]==null)continue;let x=left+step*(k-start+.5),y=yOf(series[k]);if(!begun){ctx.moveTo(x,y);begun=true;}else ctx.lineTo(x,y);}ctx.strokeStyle=["#f5bd4f","#48a8ff","#bd8cff"][n];ctx.lineWidth=period===50?1.8:1.3;ctx.stroke();});

 // SMC overlays: pivots, liquidity, BOS/CHoCH, OB/FVG and projected zone.

 const tag=(txt,x,y,color)=>{if(!txt)return;ctx.font=(color==="#e2a84a"?"bold 6px Arial":"bold 7px Arial");ctx.textAlign="left";let tw=ctx.measureText(txt).width,tx=Math.max(left,Math.min(w-right-tw-8,x)),ty=Math.max(top+10,Math.min(h-bottom,y));ctx.fillStyle="rgba(8,13,22,.9)";ctx.fillRect(tx,ty-8,tw+6,11);ctx.fillStyle=color;ctx.fillText(txt,tx+3,ty);};
 const allAnnotations=(structureOverlay.items||[]).filter(a=>Number.isFinite(a.price)&&a.time<=visibleEnd);const visibleAnnotations=allAnnotations.filter(a=>a.time>=visibleStart);
 const recent=(type,n,side)=>visibleAnnotations.filter(a=>a.type===type&&(!side||a.side===side)).sort((a,b)=>a.time-b.time);
 const annotations=[
  ...recent("pivot",2,"").filter(a=>a.label!=="PIVOTE ALTO"),...recent("liquidity",2,""),
  ...recent("bos",2).filter(a=>a.side!=="BULL"),...recent("choch",2),...recent("sweep",2),...visibleAnnotations.filter(a=>a.type==="signal"),
  ...["BUY","SELL"].flatMap(side=>{const a=allAnnotations.filter(v=>v.type==="ob"&&v.side===side&&v.time<=visibleEnd).sort((u,v)=>u.time-v.time),groups=new Map();a.forEach(v=>{if(!groups.has(v.time))groups.set(v.time,[]);groups.get(v.time).push(v);});const valid=[...groups.values()].filter(g=>g.length>=2);return valid.slice(-2).flat();})
 ];
 const xAt=time=>{const ix=data.findIndex(v=>v.time>=time);return left+(Math.max(0,ix)+.5)*step;};
 const zoneGroups=new Map();
 annotations.filter(a=>a.type==="ob"||a.type==="fvg").forEach(a=>{const key=[a.type,a.time,a.side].join("|");if(!zoneGroups.has(key))zoneGroups.set(key,[]);zoneGroups.get(key).push(a);});
 zoneGroups.forEach((items,key)=>{if(items.length<2)return;const [type,,side]=key.split("|"),vals=items.map(v=>v.price),topY=yOf(Math.max(...vals)),bottomY=yOf(Math.min(...vals)),x=xAt(items[0].time),color=type==="ob"?(side==="BUY"?"#20c997":"#ff5364"):(side==="BUY"?"#48a8ff":"#bd8cff");ctx.fillStyle=color+"22";ctx.fillRect(x,topY,Math.max(18,w-right-x),Math.max(3,bottomY-topY));ctx.strokeStyle=color;ctx.setLineDash([4,3]);ctx.strokeRect(x,topY,Math.max(18,w-right-x),Math.max(3,bottomY-topY));ctx.setLineDash([]);tag(type==="ob"?(side==="BUY"?"OB ALCISTA":"OB BAJISTA"):type.toUpperCase()+" "+side,x+3,topY-3,color);});
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
  ctx.fillStyle="rgba(255,83,100,.14)";ctx.fillRect(x1,Math.min(yEntry,yStop),Math.max(3,x2-x1),Math.abs(yEntry-yStop));
  if(t.result==="GANADA"){ctx.fillStyle="rgba(32,201,151,.14)";ctx.fillRect(x1,Math.min(yEntry,yExit),Math.max(3,x2-x1),Math.abs(yEntry-yExit));}
  ctx.lineWidth=1.3;ctx.setLineDash([4,3]);
  ctx.strokeStyle="#ff5364";ctx.beginPath();ctx.moveTo(x1,yStop);ctx.lineTo(x2,yStop);ctx.stroke();
  ctx.strokeStyle="#48a8ff";ctx.beginPath();ctx.moveTo(x1,yEntry);ctx.lineTo(x2,yEntry);ctx.stroke();
  ctx.setLineDash([]);
  const dot=(x,y,color)=>{ctx.fillStyle=color;ctx.beginPath();ctx.arc(x,y,4,0,Math.PI*2);ctx.fill();ctx.strokeStyle="#101827";ctx.lineWidth=1;ctx.stroke();};
  dot(x1,yEntry,"#48a8ff");dot(x1,yStop,"#ff5364");
  const label=(txt,x,y,color)=>{ctx.font="bold 10px Arial";ctx.textAlign="left";const tw=ctx.measureText(txt).width;ctx.fillStyle="rgba(8,13,22,.88)";ctx.fillRect(x,y-10,tw+8,14);ctx.fillStyle=color;ctx.fillText(txt,x+3,y);};
  label("ENTRADA "+Number(t.entry).toPrecision(7),Math.min(w-right-150,x1+5),yEntry-5,"#70bdff");
  label("SL "+Number(t.sl).toPrecision(7),Math.min(w-right-110,x1+5),yStop-5,"#ff7180");
  const yTp2=yOf(t.tp2);
  ctx.strokeStyle="#20c997";ctx.setLineDash([3,3]);ctx.beginPath();ctx.moveTo(x1,yTp2);ctx.lineTo(x2,yTp2);ctx.stroke();ctx.setLineDash([]);
  dot(x1,yTp2,"#20c997");
  label("TP2 "+Number(t.tp2).toPrecision(7),Math.min(w-right-130,x1+5),yTp2-5,"#43e0b0");
  const tp1=Number(t.tp1);
  if(Number.isFinite(tp1)){
   const yTp1=yOf(tp1);
   ctx.strokeStyle="#f5c451";ctx.setLineDash([3,3]);ctx.beginPath();ctx.moveTo(x1,yTp1);ctx.lineTo(x2,yTp1);ctx.stroke();ctx.setLineDash([]);
   dot(x1,yTp1,"#f5c451");
   label("TP1 "+tp1.toPrecision(7),Math.min(w-right-130,x1+5),yTp1-5,"#f5c451");
  }
  if(t.exitTime&&Number.isFinite(exitPrice)){
   const won=t.result==="GANADA";dot(x2,yExit,won?"#20c997":"#ff5364");
   const resultText=won?"GANADA":"PERDIDA";
   label(resultText+" · "+exitPrice.toPrecision(7),Math.min(w-right-145,x2+5),Math.max(top+12,yExit-19),won?"#43e0b0":"#ff7180");
  }
 });
 tradeLevels.forEach((a,i)=>{const y=yOf(a.value);ctx.strokeStyle=a.color;ctx.globalAlpha=.72;ctx.lineWidth=1;ctx.setLineDash(i===0?[]:[4,4]);ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(w-right,y);ctx.stroke();ctx.setLineDash([]);ctx.globalAlpha=1;const tag=a.label+"  "+Number(a.value).toPrecision(7);ctx.font="bold 9px Arial";const tw=ctx.measureText(tag).width+10;ctx.fillStyle="rgba(8,13,22,.88)";ctx.fillRect(w-right+2,y-8,Math.min(right-4,tw),15);ctx.fillStyle=a.color;ctx.textAlign="left";ctx.fillText(tag,w-right+7,y+3);}); if(signalMarker){const si=data.findIndex(v=>v.time===signalMarker.time);if(si>=0){const candle=data[si],sx=left+step*(si+.5),sy=yOf(signalMarker.direction==="COMPRAR"?candle.low:candle.high);ctx.fillStyle=signalMarker.direction==="COMPRAR"?"#20c997":"#ff5364";ctx.beginPath();if(signalMarker.direction==="COMPRAR"){ctx.moveTo(sx,sy+10);ctx.lineTo(sx-6,sy+20);ctx.lineTo(sx+6,sy+20);}else{ctx.moveTo(sx,sy-10);ctx.lineTo(sx-6,sy-20);ctx.lineTo(sx+6,sy-20);}ctx.closePath();ctx.fill();ctx.font="bold 9px Arial";ctx.textAlign="center";ctx.fillText(signalMarker.direction,sx,signalMarker.direction==="COMPRAR"?sy+31:sy-24);}}
 ctx.fillStyle="#8495aa";ctx.textAlign="left";ctx.fillText((candleStyle==="heikin"?"HEIKIN ASHI":"VELAS NORMALES")+" · "+(chartGranularity===30?"30s":"M"+(chartGranularity/60))+" · "+data.length+" velas",left,h-7);ctx.textAlign="right";ctx.fillText(new Date(data[data.length-1].time*1000).toLocaleTimeString("es-PA",{hour:"2-digit",minute:"2-digit"}),w-right,h-7);{const remain=chartGranularity-(Math.floor(Date.now()/1000)%chartGranularity);const mm=String(Math.floor(remain/60)).padStart(2,"0"),ss=String(remain%60).padStart(2,"0");ctx.textAlign="left";ctx.font="bold 11px Arial";ctx.fillStyle="#f5c451";ctx.fillText("CIERRE "+(chartGranularity===30?"30s":"M"+(chartGranularity/60))+" "+mm+":"+ss,left+4,top+13);}
}
function setCandleStyle(style){candleStyle=style==="normal"?"normal":"heikin";drawMarketChart();}
window.addEventListener("resize",resizeMarketChart);
setInterval(()=>{if(candleData.length)drawMarketChart();},1000);
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",createMarketChart);else createMarketChart();
