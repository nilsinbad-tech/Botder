
const DERIV_CONFIG = {
  endpoint: "wss://api.derivws.com/trading/v1/options/ws/public"
};

let derivSocket = null;
let derivConnected = false;
let availableSymbols = [];

function sendDeriv(data) {
  if (derivSocket?.readyState === WebSocket.OPEN) {
    derivSocket.send(JSON.stringify(data));
  }
}

function setConnectionStatus(connected) {
  const el = document.getElementById("connection");
  if (!el) return;

  el.textContent = connected ? "● CONECTADO" : "● DESCONECTADO";
  el.className = connected
    ? "connection online"
    : "connection offline";
}

function connectDeriv() {
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
      showDiagnostic("Error: " + data.error.message);
      return;
    }

    if (data.msg_type === "active_symbols") {
      handleActiveSymbols(data.active_symbols || []);
    }
  };

  derivSocket.onerror = () => {
    showDiagnostic("Error de conexión con Deriv.");
  };

  derivSocket.onclose = () => {
    derivConnected = false;
    setConnectionStatus(false);
    setTimeout(connectDeriv, 5000);
  };
}

function showDiagnostic(message) {
  const el = document.getElementById("api-diagnostic");
  if (el) el.textContent = message;
}

function handleActiveSymbols(symbols) {
  availableSymbols = symbols;

  const volatility = symbols.filter(item => {
    const name = String(
      item.underlying_symbol_name || item.display_name || ""
    ).toLowerCase();

    const code = String(
      item.underlying_symbol || item.symbol || ""
    ).toLowerCase();

    return name.includes("volatility") ||
           code.includes("volatility");
  });

  const count = document.getElementById("market-count");

  if (count) {
    count.textContent =
      symbols.length + " recibidos · " +
      volatility.length + " volatility";
  }

  if (!volatility.length) {
    showDiagnostic(
      "Recibidos " + symbols.length +
      " instrumentos, pero no se identificaron índices Volatility."
    );
    return;
  }

  showDiagnostic("Índices Volatility encontrados: " + volatility.length);

  renderMarkets(volatility);

  const first = volatility[0];

  selectMarket(
    first.underlying_symbol_name || first.display_name,
    first.underlying_symbol || first.symbol
  );
}

function renderMarkets(symbols) {
  const area = document.getElementById("markets");
  if (!area) return;

  area.innerHTML = "";

  symbols.forEach(item => {
    const name =
      item.underlying_symbol_name || item.display_name || "Mercado";

    const symbol =
      item.underlying_symbol || item.symbol;

    const button = document.createElement("button");
    button.className = "market";
    button.dataset.symbol = symbol;

    const title = document.createElement("strong");
    title.textContent = name;

    const code = document.createElement("span");
    code.textContent = symbol;

    button.append(title, code);

    button.addEventListener("click", () => {
      selectMarket(name, symbol);
    });

    area.appendChild(button);
  });
}

function openMarket(symbol) {
  console.log("Mercado seleccionado:", symbol);
}

function getAvailableSymbols() {
  return availableSymbols;
}

function isDerivConnected() {
  return derivConnected;
}

connectDeriv();
