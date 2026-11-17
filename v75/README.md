# BOTDER V75 — Alligator + RSI + Liquidez

Aplicación independiente para análisis y simulación de Volatility 75 (1s), símbolo `1HZ75V`.

## Estrategia implementada
- Alligator suavizado sobre precio medio: labios verdes SMMA(13) desplazamiento 8, dientes rojos SMMA(8) desplazamiento 5 y mandíbula azul SMMA(5) desplazamiento 3.
- SELL: labios verdes cruzan los dientes rojos hacia abajo y RSI(14) cruza 40 hacia abajo, cerca de resistencia/liquidez superior.
- BUY: labios verdes cruzan los dientes rojos hacia arriba y RSI(14) cruza 60 hacia arriba, cerca de soporte/liquidez inferior.
- Solo velas cortas (rango máximo 0.65 ATR y cuerpo no doji); se excluyen velas grandes y dojis.
- Zonas de soporte/resistencia construidas a partir de pivotes ZigZag repetidos; enfriamiento de 30 velas para no repetir señales en la misma zona.
- Evaluación de cada operación al cierre de la tercera vela de 1 minuto después de la entrada: BUY gana si el cierre está por encima de la entrada; SELL gana si está por debajo.
- Backtest sobre las últimas 12 horas de velas de 1 minuto.

## Conexión y seguridad
- Conexión pública de lectura a Deriv; no envía órdenes reales.
- Los resultados del backtest son simulaciones y no garantizan resultados futuros.
- Validar conexión, datos en vivo y señales en distintos mercados antes de usar decisiones reales.
