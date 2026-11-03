let activeChart = null;
let candleSeries = null;
let chartMarkers = [];

function createMarketChart(containerId) {
  const container = document.getElementById(containerId);

  if (!container || !window.LightweightCharts) {
    console.error("No se encontró el contenedor o la librería del gráfico.");
    return;
  }

  if (activeChart) {
    activeChart.remove();
  }

  activeChart = LightweightCharts.createChart(container, {
    width: container.clientWidth,
    height: 350,
    layout: {
      background: { color: "#121c2b" },
      textColor: "#d1d5db"
    },
    grid: {
      vertLines: { color: "#263244" },
      horzLines: { color: "#263244" }
    },
    timeScale: {
      timeVisible: true,
      secondsVisible: false
    },
    rightPriceScale: {
      borderColor: "#263244"
    }
  });

  candleSeries = activeChart.addSeries(
    LightweightCharts.CandlestickSeries,
    {
      upColor: "#20c997",
      downColor: "#ff5364",
      borderUpColor: "#20c997",
      borderDownColor: "#ff5364",
      wickUpColor: "#20c997",
      wickDownColor: "#ff5364"
    }
  );

  window.addEventListener("resize", resizeMarketChart);

  return activeChart;
}

function resizeMarketChart() {
  const container = document.getElementById("chart-area");

  if (activeChart && container) {
    activeChart.applyOptions({
      width: container.clientWidth
    });
  }
}

function updateCandles(candles) {
  if (!candleSeries || !Array.isArray(candles)) return;

  candleSeries.setData(candles);
}

function addCandle(candle) {
  if (!candleSeries || !candle) return;

  candleSeries.update(candle);
}

function drawTradeLevels(entry, stopLoss, takeProfit) {
  if (!candleSeries) return;

  clearTradeLevels();

  window.tradeLines = [
    candleSeries.createPriceLine({
      price: entry,
      color: "#38bdf8",
      lineWidth: 2,
      lineStyle: 0,
      title: "ENTRADA"
    }),
    candleSeries.createPriceLine({
      price: stopLoss,
      color: "#ff5364",
      lineWidth: 2,
      lineStyle: 2,
      title: "STOP LOSS"
    }),
    candleSeries.createPriceLine({
      price: takeProfit,
      color: "#20c997",
      lineWidth: 2,
      lineStyle: 2,
      title: "TAKE PROFIT"
    })
  ];
}

function clearTradeLevels() {
  if (!candleSeries || !window.tradeLines) return;

  window.tradeLines.forEach(line => {
    candleSeries.removePriceLine(line);
  });

  window.tradeLines = [];
}
