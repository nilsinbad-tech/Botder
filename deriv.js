
const DERIV_CONFIG = {
  endpoint: "wss://api.derivws.com/trading/v1/options/ws/public"
};

let derivSocket = null;
let derivConnected = false;
let availableSymbols = [];
let selectedSymbol = null;
let reconnectTimer = null;

function sendDeriv(data) {
  if (derivSocket?.readyState !== WebSocket.OPEN) return false;
  derivSocket.send(JSON.stringify(data));
  return true;
}

function setConnectionStatus(connected) {
  const el = document.getElementById("connection");
  if (!el) return;

  el.textContent = connected ? "● CONECTADO" : "● DESCONECTADO";
  el.className = connected
    ? "connection online"
    : "connection offline";
}

function showDiagnostic(message) {
  const el = document.getElementById("api-diagnostic");
  if (el) el.textContent = message;
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
    showDiagnostic("Conectado. Solicitando instrumentos...");

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
      showDiagnostic("Respuesta no válida de Deriv.");
      return;
    }

    console.log("RESPUESTA DERIV:", data);

    if (data.error) {
      showDiagnostic("Error de Deriv: " + data.error.message);
      return;
    }

    if (data.msg_type === "active_symbols") {
      handleActiveSymbols(data.active_symbols || []);
    }
  };

  derivSocket.onerror = () => {
    showDiagnostic("Error en la conexión con Deriv.");
  };

  derivSocket.onclose = () => {
    derivConnected = false;
    setConnectionStatus(false);
    showDiagnostic("Conexión cerrada. Reconectando...");

    reconnectTimer = setTimeout(connectDeriv, 5000);
  };
}

function handleActiveSymbols(symbols) {
  availableSymbols = symbols;

  const count = document.getElementById("market-count");

  if (count) {
    count.textContent = symbols.length + " instrumentos recibidos";
  }

  const area = document.getElementById("markets");

  if (!area) return;

  if (!symbols.length) {
    area.innerHTML =
      '<div class="empty-state">Deriv no devolvió instrumentos.</div>';
    showDiagnostic("Lista vacía recibida de Deriv.");
    return;
  }

  area.innerHTML = "";

  symbols.forEach((item, index) => {
    const name =
      item.display_name ||
      item.underlying_symbol_name ||
      item.name ||
      "Instrumento " + (index + 1);

    const symbol =
      item.symbol ||
      item.underlying_symbol ||
      item.underlying ||
      "";

    const card = document.createElement("button");
    card.className = "market";

    const title = document.createElement("strong");
    title.textContent = name;

    const code = document.createElement("span");
    code.textContent = "Código: " + (symbol || "No identificado");

    const details = document.createElement("span");
    details.textContent =
      "Mercado: " + (item.market || "N/D") +
      " · Submercado: " + (item.submarket || "N/D");

    const raw = document.createElement("span");
    raw.textContent = JSON.stringify(item);
    raw.style.display = "block";
    raw.style.marginTop = "8px";
    raw.style.fontSize = "9px";
    raw.style.overflowWrap = "anywhere";
    raw.style.color = "#8495aa";

    card.append(title, code, details, raw);

    if (symbol) {
      card.addEventListener("click", () => {
        selectedSymbol = symbol;

        document.querySelectorAll(".market").forEach(element => {
          element.classList.toggle(
            "active",
            element === card
          );
        });

        const chartTitle = document.getElementById("chart-title");
        if (chartTitle) chartTitle.textContent = name;

        showDiagnostic("Instrumento seleccionado: " + symbol);
      });
    }

    area.appendChild(card);
  });

  showDiagnostic(
    "Deriv respondió correctamente. Mostrando los " +
    symbols.length + " instrumentos sin filtros."
  );
}

function getAvailableSymbols() {
  return availableSymbols;
}

function isDerivConnected() {
  return derivConnected;
}

connectDeriv();
