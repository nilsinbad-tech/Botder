let candleData = [], chartSymbol = null, tradeLevels = [];
let chartCanvas = null, chartContext = null, resizeObserver = null;
function createMarketChart(containerId = "chart-area") {
  const container = document.getElementById(containerId);
  if (!container) return false;
  container.innerHTML = "";
  chartCanvas = document.createElement("canvas");
  chartCanvas.style.cssText = "position:absolute;inset:0;display:block;width:100%;height:100%;min-width:1px;min-height:1px;touch-action:pan-y;";
  chartCanvas.setAttribute("aria-label", "Gráfico de velas japonesas M1");
  container.appendChild(chartCanvas);
  chartContext = chartCanvas.getContext("2d");
  if (!chartContext) return false;
  if (resizeObserver) resizeObserver.disconnect();
  resizeObserver = new ResizeObserver(resizeMarketChart);
  resizeObserver.observe(container);
  resizeMarketChart(); drawMarketChart(); return true;
}
function resizeMarketChart() {
  if (!chartCanvas || !chartContext) return;
  const host = chartCanvas.parentElement;
  if (!host) return;
  const rect = host.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
  chartCanvas.width = Math.max(1, Math.floor(rect.width * dpr));
  chartCanvas.height = Math.max(1, Math.floor(rect.height * dpr));
  chartContext.setTransform(dpr, 0, 0, dpr, 0, 0); drawMarketChart();
}
function setChartSymbol(symbol) { chartSymbol = symbol; candleData = []; tradeLevels = []; drawMarketChart(); }
function updateCandles(candles) {
  if (!Array.isArray(candles)) return;
  candleData = candles.filter(c => [c.time,c.open,c.high,c.low,c.close].every(Number.isFinite)).sort((a,b)=>a.time-b.time).slice(-150);
  drawMarketChart();
}
function addCandle(c) {
  if (!c || ![c.time,c.open,c.high,c.low,c.close].every(Number.isFinite)) return;
  const last = candleData[candleData.length - 1];
  if (last && last.time === c.time) candleData[candleData.length - 1] = c;
  else { candleData.push(c); if (candleData.length > 150) candleData.shift(); }
  drawMarketChart();
}
function drawTradeLevels(entry, sl, tp) { tradeLevels = [{value:Number(entry),label:"ENTRADA",color:"#48a8ff"},{value:Number(sl),label:"SL",color:"#ff5364"},{value:Number(tp),label:"TP",color:"#20c997"}]; drawMarketChart(); }
function clearTradeLevels() { tradeLevels = []; drawMarketChart(); }
function getActiveChartSymbol() { return chartSymbol; }
function drawMarketChart() {
  if (!chartCanvas || !chartContext) return;
  const ctx=chartContext,w=chartCanvas.parentElement?chartCanvas.parentElement.clientWidth:0,h=chartCanvas.parentElement?chartCanvas.parentElement.clientHeight:0;
  if(!w||!h)return;
  ctx.clearRect(0,0,w,h);ctx.fillStyle="#111b2a";ctx.fillRect(0,0,w,h);
  const left=10,right=66,top=16,bottom=24,plotW=w-left-right,plotH=h-top-bottom;
  ctx.font="10px Arial";ctx.fillStyle="#8495aa";ctx.strokeStyle="#26364b";ctx.lineWidth=1;
  for(let i=0;i<=4;i++){const y=top+plotH*i/4;ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(w-right,y);ctx.stroke();}
  if(!candleData.length){ctx.fillStyle="#8495aa";ctx.font="12px Arial";ctx.textAlign="center";ctx.fillText("Esperando velas M1 de Deriv...",w/2,h/2);return;}
  const lows=candleData.map(c=>c.low),highs=candleData.map(c=>c.high);
  tradeLevels.forEach(x=>{if(Number.isFinite(x.value)){lows.push(x.value);highs.push(x.value);}});
  let min=Math.min(...lows),max=Math.max(...highs),pad=(max-min)*.08||Math.abs(max)*.0001||1;min-=pad;max+=pad;
  const yOf=v=>top+(max-v)/(max-min)*plotH;
  for(let i=0;i<=4;i++){const v=max-(max-min)*i/4,y=top+plotH*i/4;ctx.fillStyle="#8495aa";ctx.textAlign="left";ctx.fillText(v.toFixed(4),w-right+6,y+3);}
  const step=plotW/candleData.length,bodyW=Math.max(2,Math.min(9,step*.65));
  candleData.forEach((c,i)=>{const x=left+step*(i+.5),up=c.close>=c.open,color=up?"#20c997":"#ff5364";ctx.strokeStyle=color;ctx.fillStyle=color;ctx.beginPath();ctx.moveTo(x,yOf(c.high));ctx.lineTo(x,yOf(c.low));ctx.stroke();const y1=yOf(Math.max(c.open,c.close)),y2=yOf(Math.min(c.open,c.close));ctx.fillRect(x-bodyW/2,y1,bodyW,Math.max(1,y2-y1));});
  tradeLevels.forEach(level=>{const y=yOf(level.value);ctx.strokeStyle=level.color;ctx.setLineDash([4,3]);ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(w-right,y);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle=level.color;ctx.textAlign="left";ctx.fillText(level.label,w-right+5,y-4);});
  ctx.fillStyle="#8495aa";ctx.textAlign="left";ctx.fillText("M1",left,h-7);
  ctx.textAlign="right";ctx.fillText(new Date(candleData[candleData.length-1].time*1000).toLocaleTimeString("es-PA",{hour:"2-digit",minute:"2-digit"}),w-right,h-7);
}
window.addEventListener("resize",resizeMarketChart);
window.addEventListener("error",event=>{const el=document.getElementById("chart-message");if(el)el.textContent="Error del gráfico: "+(event.message||"revisa la carga");});
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",createMarketChart);else createMarketChart();
