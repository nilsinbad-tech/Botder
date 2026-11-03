
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

function showStatus(message, connected = derivConnected) {
  const el = document.getElementById("connection");
  if (!el) return;

  el.textContent = connected
    ? "● CONECTADO"
    : "● DESCONECTADO";

  el.className = connected
    ? "connection online"
    : "connection offline";

  const diagnostic = document.getElementById("api-diagnostic");

if (diagnostic) {
  diagnostic.textContent =
    "Respuesta: " + (data.msg_type || "sin tipo") +
    " | Error: " + (data.error?.message || "ninguno") +
    " | Símbolos: " + (data.active_symbols?.length ?? "sin lista");
}
console.log("[DERIV RESPUESTA]", data);
function connectDeriv() {
  derivSocket = new WebSocket(DERIV_CONFIG.endpoint);

  derivSocket.onopen = () => {
    derivConnected = true;
    showStatus("WebSocket abierto");

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
      console.error("Respuesta no válida:", event.data);
      return;
    }

    console.log("[DERIV RESPUESTA]", data);

    if (data.error) {
      showStatus("Error API: " + data.error.message);
      const count = document.getElementById("market-count");
      if (count) count.textContent = "Error de API";
      return;
    }

    if (data.msg_type === "active_symbols") {
      availableSymbols = data.active_symbols || [];
      showStatus("Lista recibida: " + availableSymbols.length);

      const count = document.getElementById("market-count");
      const area = document.getElementById("markets");

      const volatility = availableSymbols.filter(item => {
        const text = [
          item.display_name,
          item.symbol,
          item.market,
          item.submarket
        ].join(" ").toLowerCase();

        return text.includes("volatility");
      });

      if (count) {
        count.textContent =
          availableSymbols.length + " recibidos · " +
          volatility.length + " volatility";
      }

      if (!area) return;

      if (!availableSymbols.length) {
        area.innerHTML =
          '<div class="empty-state">Deriv respondió con una lista vacía.</div>';
        return;
      }

      if (!volatility.length) {
        area.innerHTML =
          '<div class="empty-state">Deriv respondió, pero no encontramos nombres Volatility. Revisa la respuesta de diagnóstico.</div>';
        return;
      }

      area.innerHTML = volatility.map(item => {
        const name = String(item.display_name || item.symbol);
        const symbol = String(item.symbol);

        return `
          <button class="market"
            data-symbol="${symbol}"
            onclick="selectMarket('${name.replace(/'/g, "\\'")}', '${symbol}')">
            <strong>${name}</strong>
            <span>${symbol}</span>
          </button>
        `;
      }).join("");

      const first = volatility[0];
      selectMarket(first.display_name || first.symbol, first.symbol);
    }
  };

  derivSocket.onerror = error => {
    showStatus("Error de WebSocket");
    console.error(error);
  };

  derivSocket.onclose = event => {
    derivConnected = false;
    showStatus("Cierre " + event.code + " " + event.reason, false);
    setTimeout(connectDeriv, 5000);
  };
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
