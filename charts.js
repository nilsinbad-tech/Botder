
let activeChart = null;
let candleSeries = null;
let priceLines = [];
let chartSymbol = null;

function createMarketChart(containerId = "chart-area") {
  const container = document.getElementById(containerId);

  if (!container || !window.LightweightCharts) {
    console.error("No se pudo cargar el gráfico.");
    return false;
  }

  if (activeChart) {
    activeChart.remove();
    activeChart = null;
  }

  container.innerHTML = "";

  activeChart = LightweightCharts.createChart(container, {
    width: container.clientWidth,
    height: container.clientHeight || 350,

    layout: {
      background: { color: "#111b2a" },
      textColor: "#d1d5db"
    },

    grid: {
      vertLines: { color: "#26364b" },
      horzLines: { color: "#26364b" }
    },

    rightPriceScale: {
      borderColor: "#26364b"
    },

    timeScale: {
      timeVisible: true,
      secondsVisible: false,
      borderColor: "#26364b"
    },

    crosshair: {
      mode: LightweightCharts.CrosshairMode.Normal
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

  chartSymbol = null;

  window.addEventListener("resize", resizeMarketChart);

  return true;
}

function resizeMarketChart() {
  const container = document.getElementById("chart-area");

  if (!activeChart || !container) return;

  activeChart.applyOptions({
    width: container.clientWidth,
    height: container.clientHeight || 350
  });
}

function setChartSymbol(symbol) {
  chartSymbol = symbol;
  clearTradeLevels();
}

function updateCandles(candles) {
  if (!candleSeries || !Array.isArray(candles)) return;

  const validCandles = candles
    .filter(c =>
      Number.isFinite(c.time) &&
      Number.isFinite(c.open) &&
      Number.isFinite(c.high) &&
      Number.isFinite(c.low) &&
      Number.isFinite(c.close)
    )
    .sort((a, b) => a.time - b.time);

  if (validCandles.length) {
    candleSeries.setData(validCandles);
    activeChart.timeScale().fitContent();
  }
}

function addCandle(candle) {
  if (!candleSeries || !candle) return;

  if (
    !Number.isFinite(candle.time) ||
    !Number.isFinite(candle.open) ||
    !Number.isFinite(candle.high) ||
    !Number.isFinite(candle.low) ||
    !Number.isFinite(candle.close)
  ) return;

  candleSeries.update(candle);
}

function drawTradeLevels(entry, stopLoss, takeProfit) {
  if (!candleSeries) return;

  clearTradeLevels();

  priceLines.push(
    candleSeries.createPriceLine({
      price: Number(entry),
      color: "#48a8ff",
      lineWidth: 2,
      lineStyle: 0,
      title: "ENTRADA"
    })
  );

  priceLines.push(
    candleSeries.createPriceLine({
      price: Number(stopLoss),
      color: "#ff5364",
      lineWidth: 2,
      lineStyle: 2,
      title: "STOP LOSS"
    })
  );

  priceLines.push(
    candleSeries.createPriceLine({
      price: Number(takeProfit),
      color: "#20c997",
      lineWidth: 2,
      lineStyle: 2,
      title: "TAKE PROFIT"
    })
  );
}

function clearTradeLevels() {
  if (!candleSeries) return;

  priceLines.forEach(line => {
    candleSeries.removePriceLine(line);
  });

  priceLines = [];
}

function getActiveChartSymbol() {
  return chartSymbol;
}
