
const DERIV_CONFIG = {
  endpoint: "wss://api.derivws.com/trading/v1/options/ws/public",
  reconnectDelay: 3000,
  pingInterval: 30000
};

let derivSocket = null;
let derivConnected = false;
let availableSymbols = [];
let selectedSymbol = null;
let tickSubscriptionId = null;
let liveCandle = null;
let pingTimer = null;
let reconnectTimer = null;
let requestCounter = 10;

function sendDeriv(data) {
  if (!derivSocket || derivSocket.readyState !== WebSocket.OPEN) {
    return false;
  }

  derivSocket.send(JSON.stringify(data));
  return true;
}

function nextRequestId() {
  requestCounter++;
  return requestCounter;
}

function setConnectionStatus(connected) {
  const element = document.getElementById("connection");
  if (!element) return;

  element.textContent = connected
    ? "● CONECTADO"
    : "● DESCONECTADO";

  element.className = connected
    ? "connection online"
    : "connection offline";
}

function startPing() {
  stopPing();

  pingTimer = setInterval(() => {
    if (derivConnected) {
      sendDeriv({ ping: 1, req_id: nextRequestId() });
    }
  }, DERIV_CONFIG.pingInterval);
}

function stopPing() {
  if (pingTimer) {
    clearInterval(pingTimer);
    pingTimer = null;
  }
}

function connectDeriv() {
  if (
    derivSocket &&
    (derivSocket.readyState === WebSocket.OPEN ||
     derivSocket.readyState === WebSocket.CONNECTING)
  ) return;

  clearTimeout(reconnectTimer);

  derivSocket = new WebSocket(DERIV_CONFIG.endpoint);

  derivSocket.onopen = () => {
    derivConnected = true;
    setConnectionStatus(true);
    startPing();

    sendDeriv({
      active_symbols: "brief",
      req_id: 1
    });
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
      console.error("Error de Deriv:", data.error.message);
      return;
    }

    switch (data.msg_type) {
      case "active_symbols":
        handleActiveSymbols(data.active_symbols || []);
        break;

      case "history":
        handleCandleHistory(data);
        break;

      case "tick":
        if (data.subscription?.id) {
          tickSubscriptionId = data.subscription.id;
        }
        handleLiveTick(data.tick);
        break;
    }
  };

  derivSocket.onerror = error => {
    console.error("Error en WebSocket:", error);
  };

  derivSocket.onclose = () => {
    derivConnected = false;
    tickSubscriptionId = null;
    stopPing();
    setConnectionStatus(false);

    reconnectTimer = setTimeout(
      connectDeriv,
      DERIV_CONFIG.reconnectDelay
    );
  };
}

function handleActiveSymbols(symbols) {
  availableSymbols = symbols;

  const volatilitySymbols = symbols
    .filter(item => {
      const name = String(item.display_name || "").toLowerCase();
      const symbol = String(item.symbol || "").toLowerCase();
      const market = String(item.market || "").toLowerCase();

      return (
        name.includes("volatility") ||
        symbol.includes("volatility") ||
        market.includes("synthetic")
      );
    })
    .sort((a, b) =>
      String(a.display_name).localeCompare(String(b.display_name))
    )
    .slice(0, 8);

  renderMarkets(volatilitySymbols);

  if (volatilitySymbols.length > 0) {
    const selected = volatilitySymbols.find(
      item => item.symbol === selectedSymbol
    ) || volatilitySymbols[0];

    selectMarket(selected.display_name, selected.symbol);
  } else {
    const area = document.getElementById("markets");

    if (area) {
      area.innerHTML =
        '<div class="empty-state">No se encontraron índices de volatilidad.</div>';
    }
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
      '<div class="empty-state">No hay mercados disponibles.</div>';
    return;
  }

  area.innerHTML = symbols.map(item => {
    const name = String(item.display_name || item.symbol)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

    const symbol = String(item.symbol)
      .replace(/[^a-zA-Z0-9_]/g, "");

    return `
      <button class="market"
        data-symbol="${symbol}"
        onclick="selectMarket('${name.replace(/'/g, "\\'")}', '${symbol}')">
        <strong>${name}</strong>
        <span>${symbol}</span>
      </button>
    `;
  }).join("");

  if (selectedSymbol) {
    document.querySelectorAll(".market").forEach(card => {
      card.classList.toggle(
        "active",
        card.dataset.symbol === selectedSymbol
      );
    });
  }
}

function unsubscribeTicks() {
  if (tickSubscriptionId) {
    sendDeriv({ forget: tickSubscriptionId });
    tickSubscriptionId = null;
  }
}

function openMarket(symbol) {
  selectedSymbol = symbol;
  liveCandle = null;

  if (!derivConnected) return;

  unsubscribeTicks();

  setChartSymbol(symbol);
  createMarketChart("chart-area");

  const message = document.getElementById("chart-message");
  if (message) {
    message.textContent = "Cargando historial M1...";
  }

  const price = document.getElementById("current-price");
  if (price) price.textContent = "---";

  sendDeriv({
    ticks_history: symbol,
    count: 5000,
    end: "latest",
    style: "ticks",
    req_id: nextRequestId()
  });

  sendDeriv({
    ticks: symbol,
    subscribe: 1,
    req_id: nextRequestId()
  });
}

function handleCandleHistory(data) {
  if (data.echo_req?.ticks_history !== selectedSymbol) return;

  const historyData = data.history;

  if (!historyData?.times || !historyData?.prices) return;

  const candlesByMinute = new Map();

  historyData.times.forEach((time, index) => {
    const price = Number(historyData.prices[index]);
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

  if (!candles.length) return;

  updateCandles(candles);
  liveCandle = { ...candles[candles.length - 1] };

  const message = document.getElementById("chart-message");

  if (message) {
    message.textContent = "Historial M1 cargado.";
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
