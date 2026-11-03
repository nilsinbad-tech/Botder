let activeChart = null, candleSeries = null, priceLines = [], chartSymbol = null;
function createMarketChart(containerId = "chart-area") {
  const container = document.getElementById(containerId);
  if (!container) return false;
  if (!window.LightweightCharts) {
    const msg = document.getElementById("chart-message");
    if (msg) msg.textContent = "No cargó la librería del gráfico. Recarga la página con internet.";
    return false;
  }
  if (activeChart) activeChart.remove();
  container.innerHTML = "";
  try {
    activeChart = LightweightCharts.createChart(container, {
      width: Math.max(container.clientWidth, 280), height: container.clientHeight || 340,
      layout: { background: { color: "#111b2a" }, textColor: "#d1d5db" },
      grid: { vertLines: { color: "#26364b" }, horzLines: { color: "#26364b" } },
      rightPriceScale: { borderColor: "#26364b" },
      timeScale: { timeVisible: true, secondsVisible: false, borderColor: "#26364b" }
    });
    candleSeries = activeChart.addSeries(LightweightCharts.CandlestickSeries, {
      upColor: "#20c997", downColor: "#ff5364", borderUpColor: "#20c997",
      borderDownColor: "#ff5364", wickUpColor: "#20c997", wickDownColor: "#ff5364"
    });
    chartSymbol = null;
    resizeMarketChart();
    return true;
  } catch (e) {
    const msg = document.getElementById("chart-message");
    if (msg) msg.textContent = "Error creando gráfico: " + e.message;
    return false;
  }
}
function resizeMarketChart() {
  const el = document.getElementById("chart-area");
  if (activeChart && el) activeChart.applyOptions({ width: Math.max(el.clientWidth, 280), height: el.clientHeight || 340 });
}
function setChartSymbol(symbol) { chartSymbol = symbol; clearTradeLevels(); }
function updateCandles(candles) {
  if (!candleSeries || !Array.isArray(candles)) return;
  const valid = candles.filter(c => [c.time,c.open,c.high,c.low,c.close].every(Number.isFinite)).sort((a,b)=>a.time-b.time);
  if (valid.length) { candleSeries.setData(valid); activeChart.timeScale().fitContent(); }
}
function addCandle(c) {
  if (candleSeries && c && [c.time,c.open,c.high,c.low,c.close].every(Number.isFinite)) candleSeries.update(c);
}
function drawTradeLevels(entry, sl, tp) {
  if (!candleSeries) return;
  clearTradeLevels();
  [[entry,"#48a8ff","ENTRADA",0],[sl,"#ff5364","STOP LOSS",2],[tp,"#20c997","TAKE PROFIT",2]].forEach(([price,color,title,lineStyle]) => {
    priceLines.push(candleSeries.createPriceLine({ price:Number(price), color, lineWidth:2, lineStyle, title }));
  });
}
function clearTradeLevels() { if (candleSeries) priceLines.forEach(x=>candleSeries.removePriceLine(x)); priceLines=[]; }
function getActiveChartSymbol() { return chartSymbol; }
window.addEventListener("resize", resizeMarketChart);
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", createMarketChart);
else createMarketChart();
