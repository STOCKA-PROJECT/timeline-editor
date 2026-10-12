# Fase 5 · Simulador y vista previa 2D

**Duración:** 1–2 semanas (27 nov – 6 dic) · **Depende de:** fases 1 y 3

## Objetivo

Ver y oír el show en el portátil tal como se verá en el belén, sin tener el belén delante. Si el calendario aprieta, esta es la fase que puede pasar a después de Navidad sin afectar al montaje.

## Entregables

- Pantalla "Vista previa" con el plano del belén y los elementos animados.
- Editor de disposición (colocar cada salida sobre el plano).
- Reproductor sincronizado con la línea de tiempo y el audio.
- Simulación de botón, sensor y fallos.

## 1. Principio

El simulador reproduce el **paquete compilado** (`frames.bin` y `events.json`), no el proyecto fuente. Así la vista previa y el belén ejecutan los mismos datos, y cualquier diferencia entre ambos es un fallo del reproductor o de la calibración, no del editor.

## 2. Disposición (`layout`)

Se guarda en el proyecto, separada del hardware, y no se envía al dispositivo. Muestra el belén como lo ve el público: no aparecen pines, relés ni cables.

La disposición es propia de cada montaje. Si al año siguiente cambia la estructura, se sustituye la foto de fondo y se recolocan las piezas; ni las piezas, ni sus salidas, ni el show cambian por ello.

| Tipo | Representación | Datos |
|---|---|---|
| `relay`, `dimmer` de luz | Halo de luz | Posición, radio, color |
| `relay` de movimiento | Icono que se anima al activarse | Posición, icono |
| `led` | Línea de puntos, uno por píxel | Polilínea |
| `motor` | Figura que se desplaza | Punto inferior y superior |
| `spot` | Círculo proyectado | Sigue al motor |
| `audio` | Icono de altavoz con nivel | Posición |

Fondo: una foto o un plano del belén. Un control de "luz ambiente" oscurece el fondo para ver el efecto de noche.

## 3. Editor de disposición

- Arrastrar cada salida desde una lista al plano.
- Dibujar el recorrido de un segmento de LED con varios puntos; los píxeles se reparten a lo largo.
- Salidas sin colocar marcadas en la lista; las piezas nuevas aparecen ahí.
- Las posiciones se guardan en coordenadas relativas al fondo, así que cambiar la foto las conserva y solo hay que mover lo que haya cambiado de sitio.
- Comandos nuevos en la capa común: `layout.setBackground`, `layout.place`, `layout.setPath`. Así Claude también puede colocar elementos.

## 4. Reproducción

- **Reloj maestro:** el audio del navegador. Los fotogramas se eligen según la posición del audio, igual que en el reproductor real.
- Cursor compartido con la línea de tiempo: mover uno mueve el otro.
- Reproducir, pausar, bucle sobre un tramo y velocidad variable (sin audio fuera de 1×).
- Dibujo con mezcla aditiva para que las luces se sumen de forma creíble.
- Recompilación en un hilo aparte y solo cuando el proyecto cambia.

## 5. Entradas y ángel simulados

- Botón de inicio en pantalla que ejecuta el mismo disparador que el físico.
- El ángel se mueve con los tiempos medidos en banco (fase 1); el sensor "salta" al llegar arriba.
- Opciones para ensayar fallos: sensor que no responde (debe verse la parada por tiempo máximo) y subida más lenta de lo normal.
- Vista del estado de reposo y de la transición reposo → show → reposo.

## 6. Modo monitor

Con el dispositivo conectado, la vista previa puede seguir el tiempo real del belén a partir de `/api/live`: se ve en el portátil lo que está pasando físicamente, útil para depurar desde lejos.

Opcional: enviar al dispositivo el fotograma del cursor al moverlo, para ajustar colores sobre el belén real.

## 7. Herramientas MCP que se completan

- `seek_preview` y `play_preview` pasan a mover la vista previa real.
- Nueva `place_on_layout` sobre los comandos `layout.*`.

## Tareas

- [ ] Lector de `frames.bin` y `events.json` en el navegador.
- [ ] Lienzo con fondo, halos, tiras y mezcla aditiva.
- [ ] Editor de disposición y comandos `layout.*`.
- [ ] Sincronización con audio y con la línea de tiempo.
- [ ] Simulación de botón, motor, sensor y foco.
- [ ] Fallos simulados.
- [ ] Modo monitor.

## Criterios de aceptación

- Grabar en vídeo un pase real y compararlo con la vista previa: los cambios coinciden en el tiempo.
- Mover el cursor por la línea de tiempo actualiza la vista sin retraso apreciable.
- Un show de 5 minutos se recompila en pocos segundos tras un cambio.
- Simular el fallo del sensor muestra la parada por tiempo máximo y el aviso.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| La vista previa promete colores que el belén no da | Calibración de brillo y gamma por tira; ajustar con el modo monitor |
| Rendimiento con muchas luces | Dibujar por lotes; reducir la resolución del lienzo si hace falta |
| Tiempo insuficiente antes del montaje | Versión mínima: solo halos y tiras, sin iconos ni fallos simulados |
