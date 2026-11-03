
const DERIV_CONFIG = {
  endpoint: "wss://api.derivws.com/trading/v1/options/ws/public"
};

let derivSocket = null;
let derivConnected = false;
let availableSymbols = [];
let selectedSymbol = null;
let tickSubscriptionId = null;
let liveCandle = null;

function sendDeriv(data) {
  if (!derivSocket || derivSocket.readyState !== WebSocket.OPEN) return;
  derivSocket.send(JSON.stringify(data));
}

function setConnectionStatus(connected, message) {
  const element = document.getElementById("connection");
  if (!element) return;

  element.textContent = connected ? "● CONECTADO" : "● DESCONECTADO";
  element.className = connected ? "connection online" : "connection offline";

  if (!connected && message) {
    console.warn(message);
  }
}

function connectDeriv() {
  if (
    derivSocket &&
    (derivSocket.readyState === WebSocket.OPEN ||
     derivSocket.readyState === WebSocket.CONNECTING)
  ) return;

  derivSocket = new WebSocket(DERIV_CONFIG.endpoint);

  derivSocket.onopen = () => {
    derivConnected = true;
    setConnectionStatus(true);
    sendDeriv({ active_symbols: "brief", req_id: 1 });
  };

  derivSocket.onmessage = event => {
    let data;

    try {
      data = JSON.parse(event.data);
    } catch (error) {
      console.error("Respuesta inválida de Deriv", error);
      return;
    }

    if (data.error) {
      console.error("Deriv:", data.error.message);
      return;
    }

    if (data.msg_type === "active_symbols") {
      handleActiveSymbols(data.active_symbols || []);
    }

    if (data.msg_type === "candles") {
      handleCandleHistory(data);
    }

    if (data.msg_type === "tick") {
      handleLiveTick(data.tick);
    }
  };

  derivSocket.onclose = () => {
    derivConnected = false;
    setConnectionStatus(false, "Conexión cerrada");
    setTimeout(connectDeriv, 5000);
  };

  derivSocket.onerror = error => {
    console.error("Error de conexión con Deriv", error);
    setConnectionStatus(false);
  };
}

function handleActiveSymbols(symbols) {
  availableSymbols = symbols;

  const volatilitySymbols = symbols
    .filter(item => {
      const name = String(item.display_name || "").toLowerCase();
      const market = String(item.market || "").toLowerCase();

      return name.includes("volatility") ||
             market.includes("synthetic");
    })
    .sort((a, b) =>
      String(a.display_name).localeCompare(String(b.display_name))
    )
    .slice(0, 8);

  renderMarkets(volatilitySymbols);

  if (volatilitySymbols.length) {
    const first = volatilitySymbols[0];
    selectMarket(first.display_name, first.symbol);
  } else {
    document.getElementById("markets").innerHTML =
      '<div class="empty-state">No se encontraron índices de volatilidad.</div>';
  }
}

function renderMarkets(symbols) {
  const area = document.getElementById("markets");
  const count = document.getElementById("market-count");

  if (!area) return;

  count.textContent = symbols.length + " instrumentos";

  if (!symbols.length) {
    area.innerHTML = '<div class="empty-state">No hay mercados disponibles.</div>';
    return;
  }

  area.innerHTML = symbols.map(item => `
    <button class="market"
      data-symbol="${item.symbol}"
      onclick="selectMarket('${item.display_name.replace(/'/g, "\\'")}', '${item.symbol}')">
      <strong>${item.display_name}</strong>
      <span>${item.symbol}</span>
    </button>
  `).join("");
}

function requestCandles(symbol) {
  sendDeriv({
    ticks_history: symbol,
    style: "candles",
    granularity: 60,
    count: 200,
    end: "latest",
    req_id: 2
  });
}

function handleCandleHistory(data) {
  if (!data.echo_req ||
      data.echo_req.ticks_history !== selectedSymbol) return;

  const candles = (data.candles || []).map(c => ({
    time: Number(c.epoch),
    open: Number(c.open),
    high: Number(c.high),
    low: Number(c.low),
    close: Number(c.close)
  }));

  if (candles.length) {
    updateCandles(candles);

    const message = document.getElementById("chart-message");
    if (message) message.textContent = "Velas M1 recibidas.";
  }
}

function subscribeTicks(symbol) {
  sendDeriv({
    ticks: symbol,
    subscribe: 1,
    req_id: 3
  });
}

function handleLiveTick(tick) {
  if (!tick || tick.symbol !== selectedSymbol) return;

  const price = Number(tick.quote);
  const epoch = Number(tick.epoch);

  if (!Number.isFinite(price) || !Number.isFinite(epoch)) return;

  const priceElement = document.getElementById("current-price");
  if (priceElement) priceElement.textContent = price;

  updateOperationPrice(tick.symbol, price);
  updateLiveCandle(price, epoch);
}

function updateLiveCandle(price, epoch) {
  const minute = Math.floor(epoch / 60) * 60;

  if (!liveCandle || liveCandle.time !== minute) {
    liveCandle = {
      time: minute,
      open: price,
      high: price,
      low: price,
      close: price
    };
  } else {
    liveCandle.high = Math.max(liveCandle.high, price);
    liveCandle.low = Math.min(liveCandle.low, price);
    liveCandle.close = price;
  }

  addCandle({ ...liveCandle });
}

function unsubscribeTicks() {
  if (tickSubscriptionId) {
    sendDeriv({ forget: tickSubscriptionId });
    tickSubscriptionId = null;
  }
}

function openMarket(symbol) {
  if (!derivConnected) return;

  unsubscribeTicks();

  selectedSymbol = symbol;
  liveCandle = null;

  setChartSymbol(symbol);
  createMarketChart("chart-area");

  requestCandles(symbol);
  subscribeTicks(symbol);
}

function getAvailableSymbols() {
  return availableSymbols;
}

function isDerivConnected() {
  return derivConnected;
}

connectDeriv();
