let candleData=[],chartSymbol=null,tradeLevels=[],chartCanvas=null,chartContext=null,resizeObserver=null;
let viewEnd=0,viewCount=100,dragX=null,dragEnd=0,activePointers=new Map(),pinchStart=0,pinchCount=100,chartFrame=null,scaleMin=null,scaleMax=null,scaleWindow="",chartGranularity=60;
function createMarketChart(containerId="chart-area"){
 const host=document.getElementById(containerId);if(!host)return false;
 host.innerHTML="";chartCanvas=document.createElement("canvas");
 chartCanvas.style.cssText="position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;cursor:grab";
 host.appendChild(chartCanvas);
 chartContext=chartCanvas.getContext("2d");if(!chartContext)return false;
 if(resizeObserver)resizeObserver.disconnect();resizeObserver=new ResizeObserver(resizeMarketChart);resizeObserver.observe(host);
 chartCanvas.addEventListener("pointerdown",e=>{
  activePointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
  chartCanvas.setPointerCapture(e.pointerId);
  if(activePointers.size===1){dragX=e.clientX;dragEnd=viewEnd;chartCanvas.style.cursor="grabbing";}
  if(activePointers.size===2){const p=[...activePointers.values()];pinchStart=Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y);pinchCount=viewCount;dragX=null;}
 });
 chartCanvas.addEventListener("pointermove",e=>{
  if(!activePointers.has(e.pointerId))return;
  activePointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(activePointers.size>=2){
   const p=[...activePointers.values()],dist=Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y);
   if(pinchStart>0)viewCount=Math.max(15,Math.min(500,Math.round(pinchCount*pinchStart/Math.max(1,dist))));
   viewEnd=candleData.length;drawMarketChart();return;
  }
  if(dragX===null)return;
  const step=(chartCanvas.parentElement.clientWidth-76)/Math.max(1,viewCount);
  const shift=Math.round((dragX-e.clientX)/Math.max(1,step));
  viewEnd=Math.max(Math.min(viewCount,candleData.length),Math.min(candleData.length,dragEnd+shift));drawMarketChart();
 });
 const endDrag=e=>{activePointers.delete(e.pointerId);if(activePointers.size<2)pinchStart=0;if(activePointers.size===1){const p=[...activePointers.values()][0];dragX=p.x;dragEnd=viewEnd;}else{dragX=null;chartCanvas.style.cursor="grab";}};
 chartCanvas.addEventListener("pointerup",endDrag);chartCanvas.addEventListener("pointercancel",endDrag);
 chartCanvas.addEventListener("wheel",e=>{e.preventDefault();viewCount=Math.max(15,Math.min(500,Math.round(viewCount*(e.deltaY>0?1.2:.82))));viewEnd=candleData.length;drawMarketChart();},{passive:false});
 resizeMarketChart();drawMarketChart();return true;
}
function resizeMarketChart(){if(!chartCanvas||!chartContext)return;const host=chartCanvas.parentElement;if(!host)return;const r=host.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2);chartCanvas.width=Math.max(1,Math.floor(r.width*dpr));chartCanvas.height=Math.max(1,Math.floor(r.height*dpr));chartContext.setTransform(dpr,0,0,dpr,0,0);drawMarketChart();}
function setChartSymbol(s){chartSymbol=s;candleData=[];tradeLevels=[];viewEnd=0;viewCount=100;scaleMin=null;scaleMax=null;scaleWindow="";drawMarketChart();}\nfunction setChartGranularity(seconds){chartGranularity=Number(seconds)||60;scaleMin=null;scaleMax=null;scaleWindow="";drawMarketChart();}
function updateCandles(c){if(!Array.isArray(c))return;candleData=c.filter(x=>[x.time,x.open,x.high,x.low,x.close].every(Number.isFinite)).sort((a,b)=>a.time-b.time).slice();viewEnd=candleData.length;scaleMin=null;scaleMax=null;scaleWindow="";drawMarketChart();}
function addCandle(c){if(!c||![c.time,c.open,c.high,c.low,c.close].every(Number.isFinite))return;const following=viewEnd>=candleData.length;const last=candleData[candleData.length-1];if(last&&last.time===c.time)candleData[candleData.length-1]=c;else{candleData.push(c);}if(following)viewEnd=candleData.length;else viewEnd=Math.min(viewEnd,candleData.length);drawMarketChart();}
function drawTradeLevels(e,s,t){tradeLevels=[{value:Number(e),label:"ENTRADA",color:"#48a8ff"},{value:Number(s),label:"SL",color:"#ff5364"},{value:Number(t),label:"TP",color:"#20c997"}];drawMarketChart();}
function clearTradeLevels(){tradeLevels=[];drawMarketChart();}
function getActiveChartSymbol(){return chartSymbol;}
function drawMarketChart(){if(chartFrame!==null)return;chartFrame=requestAnimationFrame(()=>{chartFrame=null;renderMarketChart();});}
function renderMarketChart(){
 if(!chartCanvas||!chartContext)return;const ctx=chartContext,w=chartCanvas.parentElement?.clientWidth||0,h=chartCanvas.parentElement?.clientHeight||0;if(!w||!h)return;
 ctx.clearRect(0,0,w,h);ctx.fillStyle="#111b2a";ctx.fillRect(0,0,w,h);
 const left=10,right=66,top=16,bottom=25,pw=w-left-right,ph=h-top-bottom;
 ctx.font="10px Arial";ctx.strokeStyle="#26364b";ctx.lineWidth=1;
 for(let i=0;i<=4;i++){let y=top+ph*i/4;ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(w-right,y);ctx.stroke();}
 if(!candleData.length){ctx.fillStyle="#8495aa";ctx.textAlign="center";ctx.font="12px Arial";ctx.fillText("Esperando velas M1...",w/2,h/2);return;}
 const end=Math.max(0,Math.min(candleData.length,viewEnd||candleData.length)),start=Math.max(0,end-viewCount),data=candleData.slice(start,end);
 if(!data.length)return;const windowKey=start+":"+end+":"+viewCount;let lows=data.map(c=>c.low),highs=data.map(c=>c.high);tradeLevels.forEach(x=>{if(Number.isFinite(x.value)){lows.push(x.value);highs.push(x.value);}});
 const rawMin=Math.min(...lows),rawMax=Math.max(...highs);
 if(scaleWindow!==windowKey||scaleMin===null||scaleMax===null){const pad=(rawMax-rawMin)*.08||Math.abs(rawMax)*.0001||1;scaleMin=rawMin-pad;scaleMax=rawMax+pad;scaleWindow=windowKey;}else{const span=scaleMax-scaleMin,pad=span*.08;if(rawMin<scaleMin+pad)scaleMin=rawMin-pad;if(rawMax>scaleMax-pad)scaleMax=rawMax+pad;}
 const min=scaleMin,max=scaleMax;
 const yOf=v=>top+(max-v)/(max-min)*ph;
 for(let i=0;i<=4;i++){let v=max-(max-min)*i/4,y=top+ph*i/4;ctx.fillStyle="#8495aa";ctx.textAlign="left";ctx.fillText(v.toFixed(4),w-right+5,y+3);}
 const step=pw/Math.max(viewCount,data.length),bw=Math.max(2,Math.min(10,step*.65));
 data.forEach((c,i)=>{let x=left+step*(i+.5),color=c.close>=c.open?"#20c997":"#ff5364";ctx.strokeStyle=color;ctx.fillStyle=color;ctx.beginPath();ctx.moveTo(x,yOf(c.high));ctx.lineTo(x,yOf(c.low));ctx.stroke();let y1=yOf(Math.max(c.open,c.close)),y2=yOf(Math.min(c.open,c.close));ctx.fillRect(x-bw/2,y1,bw,Math.max(1,y2-y1));});
 tradeLevels.forEach(a=>{let y=yOf(a.value);ctx.strokeStyle=a.color;ctx.setLineDash([4,3]);ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(w-right,y);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle=a.color;ctx.textAlign="left";ctx.fillText(a.label,w-right+5,y-4);});
 ctx.fillStyle="#8495aa";ctx.textAlign="left";ctx.fillText("M"+(chartGranularity/60)+" · "+data.length+" velas",left,h-7);ctx.textAlign="right";ctx.fillText(new Date(data[data.length-1].time*1000).toLocaleTimeString("es-PA",{hour:"2-digit",minute:"2-digit"}),w-right,h-7);
}
window.addEventListener("resize",resizeMarketChart);
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",createMarketChart);else createMarketChart();
