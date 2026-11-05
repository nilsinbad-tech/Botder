# BOTDER · Deriv Structural Lab

Aplicación web móvil para análisis de índices sintéticos Deriv, gráficos, señales proyectadas y backtesting histórico.

## Alcance inicial
- Conexión pública a Deriv para descubrir instrumentos y descargar velas.
- Lista priorizada de 25 símbolos: Volatility 1s, Volatility estándar, Step Index, Crash/Boom y Jump. Solo se muestran los símbolos que Deriv devuelve como activos.
- Temporalidades M1–M5: M2–M5 se agregan desde las velas M1.
- Cruce EMA 9/21 con filtro EMA 50, RSI(14), OB y liquidez aproximada desde M5, pivotes confirmados y niveles proyectados.
- Backtesting local de hasta 7 días (10.080 velas M1 por instrumento) y registro de operaciones simuladas.
- Gráfico navegable con Lightweight Charts.

## Importante
Esta versión es un primer motor funcional y necesita validación con datos en vivo y revisión adicional de reglas OB/pivotes. Las zonas OB se aproximan con velas M5; no son detección institucional completa. No ejecuta órdenes reales. Los niveles, resultados y señales son simulados y no garantizan resultados futuros.

## Publicación
Activar GitHub Pages desde Settings → Pages → Deploy from a branch → main → /(root).
