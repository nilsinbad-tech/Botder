const DERIV_CONFIG = {
  appId: "TU_APP_ID",
  endpoint: "wss://ws.derivws.com/websockets/v3"
};

let derivSocket = null;
let derivConnected = false;
let availableSymbols = [];
let tickSubscriptions = {};

function connectDeriv() {
  if (derivSocket && derivSocket.readyState === WebSocket.OPEN) {
    return;
  }

  derivSocket = new WebSocket(
    `${DERIV_CONFIG.endpoint}?app_id=${DERIV_CONFIG.appId}`
  );

  derivSocket.onopen = () => {
    derivConnected = true;
    console.log("Conectado a Deriv");

    derivSocket.send(JSON.stringify({
      active_symbols: "brief",
      product_type: "basic"
    }));
  };

  derivSocket.onmessage = (event) => {
    const data = JSON.parse(event.data);

    if (data.error) {
      console.error("Error Deriv:", data.error.message);
      return;
    }

    if (data.msg_type === "active_symbols") {
      availableSymbols = data.active_symbols || [];
      console.log("Instrumentos disponibles:", availableSymbols);
      document.dispatchEvent(new CustomEvent("derivSymbols", {
        detail: availableSymbols
      }));
    }

    if (data.msg_type === "history") {
      const candles = (data.candles || []).map(c => ({
        time: Number(c.epoch),
        open: Number(c.open),
        high: Number(c.high),
        low: Number(c.low),
        close: Number(c.close)
      }));

      document.dispatchEvent(new CustomEvent("derivHistory", {
        detail: {
          symbol: data.echo_req?.ticks_history,
          candles
        }
      }));
    }

    if (data.msg_type === "tick") {
      document.dispatchEvent(new CustomEvent("derivTick", {
        detail: data.tick
      }));
    }
  };

  derivSocket.onclose = () => {
    derivConnected = false;
    console.log("Conexión Deriv cerrada");
  };

  derivSocket.onerror = (error) => {
    console.error("Error de conexión Deriv:", error);
  };
}

function requestCandles(symbol) {
  if (!derivConnected) return;

  derivSocket.send(JSON.stringify({
    ticks_history: symbol,
    style: "candles",
    granularity: 60,
    count: 200,
    end: "latest"
  }));
}

function subscribeTicks(symbol) {
  if (!derivConnected || tickSubscriptions[symbol]) return;

  derivSocket.send(JSON.stringify({
    ticks: symbol,
    subscribe: 1
  }));

  tickSubscriptions[symbol] = true;
}

function unsubscribeTicks(symbol) {
  if (!derivConnected) return;

  derivSocket.send(JSON.stringify({
    forget_all: "ticks"
  }));

  tickSubscriptions = {};
}

function getAvailableSymbols() {
  return availableSymbols;
}

function isDerivConnected() {
  return derivConnected;
    }
