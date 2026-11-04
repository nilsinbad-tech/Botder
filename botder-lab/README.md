# BOTDER LAB — prototipo independiente

Este directorio es una prueba aislada. No modifica ni reemplaza los archivos existentes de BOTDER.

## Ejecutar
Abre `index.html` en un navegador moderno. No requiere instalación, servidor, cuenta ni token.

## Motores
- **Tres toques:** pivotes ZigZag confirmados, línea diagonal de soporte/resistencia, tres contactos separados, rechazo y tres cierres consecutivos a favor. TP1 usa el borde opuesto del canal; TP2 usa el siguiente pivote estructural disponible; SL usa el primer toque. Esta es una hipótesis de trabajo visible y modificable, NO una especificación final aprobada.
- **Estructura/liquidez:** calcula pivotes, zonas de liquidez, OB y FVG como contexto. No genera entradas todavía porque la condición exacta de entrada de este motor aún no ha sido confirmada.

## Pruebas
Abre `tests.html` para ejecutar pruebas deterministas del motor de tres toques y del aislamiento entre motores.

## Límites
- Los datos del gráfico son sintéticos de demostración.
- No hay conexión Deriv, feed en vivo, ejecución MT5 ni promesa de rentabilidad.
- El prototipo comprueba lógica local, no disponibilidad ni comportamiento real de la API Deriv.
