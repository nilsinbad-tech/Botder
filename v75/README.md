# BOTDER Signal Lab — Alligator + RCI + ruptura de pivotes

Aplicación para análisis y simulación de Volatility 5 (1s), Volatility 30 (1s) y Volatility 75 (1s). Los símbolos se descubren mediante `active_symbols` de Deriv y se usa el código devuelto por la API; códigos esperados: `1HZ5V`, `1HZ30V` y `1HZ75V`.

## Estrategia implementada
- Alligator suavizado sobre precio medio: labios verdes SMMA(13) desplazamiento 8, dientes rojos SMMA(8) desplazamiento 5 y mandíbula azul SMMA(5) desplazamiento 3.
- SELL: labios verdes cruzan los dientes rojos hacia abajo y RCI(14) desciende desde 50 hacia 45–40, con ruptura del último pivote mínimo confirmado.
- BUY: labios verdes cruzan los dientes rojos hacia arriba y RCI(14) asciende desde 50 hacia 55–60, con ruptura del último pivote máximo confirmado.
- Solo velas cortas (rango máximo 0.65 ATR y cuerpo no doji); se excluyen velas grandes y dojis.
- Ruptura del último pivote ZigZag confirmado en la dirección de la señal; enfriamiento de 30 velas para evitar señales repetidas en el mismo pivote.
- Evaluación de cada operación al cierre de la tercera vela de 1 minuto después de la entrada: BUY gana si el cierre está por encima de la entrada; SELL gana si está por debajo.
- Backtest sobre las últimas 12 horas de velas de 1 minuto.

## Conexión y seguridad
- Conexión pública de lectura a Deriv; no envía órdenes reales.
- Los resultados del backtest son simulaciones y no garantizan resultados futuros.
- Validar conexión, datos en vivo y señales en distintos mercados antes de usar decisiones reales.

## Instrumentos
- Selector de Volatility 5 (1s), Volatility 30 (1s) y Volatility 75 (1s).
- La aplicación consulta `active_symbols` y solo habilita los instrumentos que Deriv devuelve como disponibles; así evita usar etiquetas o códigos inventados.
- Al cambiar de instrumento, cancela la suscripción anterior, descarga 12 horas de velas de 1 minuto, recalcula indicadores y backtest, y crea una nueva suscripción de ticks para actualizar el gráfico.
