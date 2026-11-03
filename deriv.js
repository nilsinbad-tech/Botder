
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
  if (derivSocket?.readyState === WebSocket.OPEN) {
    derivSocket.send(JSON.stringify(data));
  }
}

function setConnectionStatus(connected) {
  const element = document.getElementById("connection");
  if (!element) return;

  element.textContent = connected ? "● CONECTADO" : "● DESCONECTADO";
  element.className = connected
    ? "connection online"
    : "connection offline";
}

function connectDeriv() {
  if (derivSocket &&
      (derivSocket.readyState === WebSocket.OPEN ||
       derivSocket.readyState === WebSocket.CONNECTING)) return;

  derivSocket = new WebSocket(DERIV_CONFIG.endpoint);

  derivSocket.onopen = () => {
    derivConnected = true;
    setConnectionStatus(true);

    sendDeriv({
      active_symbols: "brief",
      req_id: 1
    });
  };

  derivSocket.onmessage = event => {
    let data;

    try {
      data = JSON.parse(event.data);
    } catch {
      return;
    }

    if (data.error) {
      console.error("Deriv:", data.error.message);
      return;
    }

    if (data.msg_type === "active_symbols") {
      handleActiveSymbols(data.active_symbols || []);
    }

    if (data.msg_type === "history") {
      handleCandleHistory(data);
    }

    if (data.msg_type === "tick") {
      if (data.subscription?.id) {
        tickSubscriptionId = data.subscription.id;
      }

      handleLiveTick(data.tick);
    }
  };

  derivSocket.onclose = () => {
    derivConnected = false;
    setConnectionStatus(false);
    setTimeout(connectDeriv, 5000);
  };

  derivSocket.onerror = error => {
    console.error("Error de conexión:", error);
    setConnectionStatus(false);
  };
}

function handleActiveSymbols(symbols) {
  availableSymbols = symbols;

  const volatilitySymbols = symbols
    .filter(item =>
      String(item.display_name || "")
        .toLowerCase()
        .includes("volatility")
    )
    .sort((a, b) =>
      String(a.display_name).localeCompare(String(b.display_name))
    )
    .slice(0, 8);

  renderMarkets(volatilitySymbols);

  if (volatilitySymbols.length) {
    const first = volatilitySymbols[0];
    selectMarket(first.display_name, first.symbol);
  }
}

function renderMarkets(symbols) {
  const area = document.getElementById("markets");
  const count = document.getElementById("market-count");

  if (!area) return;

  if (count) {
    count.textContent = symbols.length + " instrumentos";
  }

  if (!symbols.length) {
    area.innerHTML =
      '<div class="empty-state">No se encontraron índices de volatilidad.</div>';
    return;
  }

  area.innerHTML = symbols.map(item => `
    <button class="market"
      data-symbol="${item.symbol}"
      onclick="selectMarket('${String(item.display_name).replace(/'/g, "\\'")}', '${item.symbol}')">
      <strong>${item.display_name}</strong>
      <span>${item.symbol}</span>
    </button>
  `).join("");
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

  sendDeriv({
    ticks_history: symbol,
    count: 5000,
    end: "latest",
    style: "ticks",
    req_id: 2
  });

  sendDeriv({
    ticks: symbol,
    subscribe: 1,
    req_id: 3
  });

  const price = document.getElementById("current-price");
  if (price) price.textContent = "---";
}

function handleCandleHistory(data) {
  if (data.echo_req?.ticks_history !== selectedSymbol) return;

  const history = data.history;
  if (!history?.times || !history?.prices) return;

  const candlesByMinute = new Map();

  history.times.forEach((time, index) => {
    const price = Number(history.prices[index]);
    const minute = Math.floor(Number(time) / 60) * 60;

    if (!Number.isFinite(price)) return;

    if (!candlesByMinute.has(minute)) {
      candlesByMinute.set(minute, {
        time: minute,
        open: price,
        high: price,
        low: price,
        close: price
      });
    } else {
      const candle = candlesByMinute.get(minute);
      candle.high = Math.max(candle.high, price);
      candle.low = Math.min(candle.low, price);
      candle.close = price;
    }
  });

  const candles = Array.from(candlesByMinute.values())
    .sort((a, b) => a.time - b.time);

  if (candles.length) {
    updateCandles(candles);

    const message = document.getElementById("chart-message");
    if (message) {
      message.textContent = "Historial M1 cargado desde ticks.";
    }

    const last = candles[candles.length - 1];
    liveCandle = { ...last };
  }
}

function handleLiveTick(tick) {
  if (!tick || tick.symbol !== selectedSymbol) return;

  const price = Number(tick.quote);
  const epoch = Number(tick.epoch);

  if (!Number.isFinite(price) || !Number.isFinite(epoch)) return;

  const priceElement = document.getElementById("current-price");
  if (priceElement) {
    priceElement.textContent = price;
  }

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

function getAvailableSymbols() {
  return availableSymbols;
}

function isDerivConnected() {
  return derivConnected;
}

connectDeriv();
