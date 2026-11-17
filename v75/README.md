# V75 Signal Lab — EMA + RSI + ZigZag

Aplicación nueva e independiente para Volatility 75 (1s), desarrollada en la carpeta `v75/`.

## Qué incluye
- Conexión pública de lectura a Deriv y símbolo `1HZ75V`.
- Histórico de velas de 1 minuto de las últimas 12 horas.
- Gráfico con velas y EMA 9/30/50.
- Señal anticipada con precio esperado, TP y SL dibujados como líneas de precio.
- Backtesting de 12 horas y marcadores BUY/SELL y WIN/LOSS.
- Parámetros configurables de RSI, ZigZag, retroceso y riesgo/beneficio.
- No envía órdenes reales.

## Notas
La señal es una prealerta; el backtest simula el toque del nivel esperado y la salida por TP/SL. Si TP y SL se alcanzan dentro de la misma vela, se contabiliza conservadoramente como SL. La precisión y rentabilidad deben validarse con datos suficientes y pruebas fuera de muestra.

Para publicar esta nueva versión, integrar el contenido de esta rama en la rama configurada para GitHub Pages.
