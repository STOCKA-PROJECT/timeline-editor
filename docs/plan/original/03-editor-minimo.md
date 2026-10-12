# Fase 3 · Editor mínimo

**Duración:** 2–3 semanas (2–22 nov) · **Depende de:** fases 1 y 2

## Objetivo

Una aplicación web local en el portátil para indicar a qué salida está conectada cada pieza, montar la línea de tiempo, probar salidas y subir el show, sin escribir JSON a mano. El editor no dibuja el hardware: solo guarda la asignación. La vista previa del belén en acción queda para la fase 5.

## Entregables

- Servidor local (Node) con el estado del proyecto y la conexión al dispositivo.
- Interfaz (React) con cuatro pantallas: Piezas, Línea de tiempo, Escenas y Dispositivo.
- Capa de comandos con deshacer y rehacer.

## 1. Estructura del repositorio

```
belen/
  packages/
    core/     # esquema, comandos, validación, compilador (TypeScript)
    server/   # estado del proyecto, WebSocket, cliente del dispositivo, MCP
    ui/       # React
    cli/      # belen validate / compile / deploy
  player-rpi/     # Python (fase 2)
  player-esp32/   # C++ (fase 6)
  boards/         # perfiles de placa
  docs/
```

## 2. Capa de comandos

Es la pieza central: toda modificación del proyecto es un comando con nombre y datos. La interfaz, la CLI y el MCP usan exactamente los mismos.

| Grupo | Comandos |
|---|---|
| Hardware | `hardware.setBoard`, `hardware.addPort`, `hardware.addOutput`, `hardware.updateOutput`, `hardware.renameOutput`, `hardware.removeOutput`, `hardware.addInput` |
| LEDs y grupos | `led.addSegment`, `led.setCount`, `led.reorderChain`, `group.create`, `group.update` |
| Escenas | `scene.create`, `scene.update`, `scene.remove` |
| Línea de tiempo | `timeline.addTrack`, `timeline.addClip`, `timeline.moveClip`, `timeline.resizeClip`, `timeline.updateClip`, `timeline.removeClip`, `timeline.setDuration` |
| Disparadores | `trigger.set`, `idle.set` |

Cada comando:

- se valida contra el esquema antes de aplicarse;
- genera su inverso (deshacer/rehacer);
- lleva origen (`ui`, `mcp`, `cli`) para poder resaltar en pantalla lo que cambia Claude;
- `hardware.renameOutput` actualiza todas las referencias en grupos, escenas y pistas;
- `hardware.removeOutput` quita también las pistas y referencias de esa pieza, en un solo paso de deshacer;
- `led.setCount` y `led.reorderChain` recalculan los rangos de píxeles de todas las piezas que van detrás en la tira.

## 3. Estado y sincronización

- El servidor es la única fuente de verdad. La interfaz envía comandos por WebSocket y recibe los cambios resultantes.
- Guardado automático en `project.json` dentro de la carpeta del proyecto, junto a `audio/`.
- Varias pestañas (o Claude) pueden trabajar sobre el mismo proyecto a la vez.
- "Duplicar proyecto": punto de partida para el montaje del año siguiente; conserva piezas, escenas y show.
- La conexión con el dispositivo se define como una interfaz (`DeviceTransport`) con una única implementación por ahora: HTTP y WebSocket. Bluetooth y serie se añadirán en la fase 6 sin tocar el resto.

## 4. Pantallas

**Piezas**

Una tabla de asignación, sin ningún dibujo del cableado ni de la electrónica. Una fila por pieza:

| Columna | Ejemplo |
|---|---|
| Nombre | Herrero |
| Tipo | Relé |
| Salida | Expansor 1 · canal 3 |
| Opciones | Activo a nivel bajo |

- El desplegable de salida solo ofrece las que están libres y son válidas.
- Botón "Identificar" en cada fila: activa esa salida unos segundos para ver qué pieza responde. Sirve para asignar tras cablear o recablear.
- Tiras de LED: cada tira es una lista ordenada de piezas con su número de LEDs (posada 4, herrero 6, establo 5...). Al reordenar la lista o cambiar un número, los rangos de píxeles se recalculan solos.
- Gestión de grupos.
- Ajustes del controlador, que se tocan pocas veces: placa, expansores conectados y longitud de cada tira. Es lo mínimo que el editor necesita para saber qué salidas existen.

**Línea de tiempo**

- Una pista por salida o grupo, más la pista de escenas.
- Clips que se crean, mueven y estiran con el ratón; ajuste a rejilla; zoom.
- Pista de audio con forma de onda.
- Panel de propiedades del clip seleccionado.
- Esta fase incluye `set`, `fade`, `scene`, `audio`, `motor` y tres o cuatro efectos de LED.

**Escenas**

- Lista de escenas y editor del valor de cada salida.
- "Capturar": crear una escena a partir de lo que hay activo en modo prueba.

**Dispositivo**

- Conectar por nombre o IP; ver placa, versión, show activo y estado.
- Modo prueba: interruptor, deslizador o selector de color por salida; mover el ángel manteniendo pulsado; estado de sensores en vivo.
- Calibración del foco: ajustar posición y radio arriba y abajo viéndolo en el proyector.
- Subir show, volver al anterior, ver registros.

## 5. Validación antes de subir

Se añaden a las de la fase 1:

| Regla | Nivel |
|---|---|
| `board` del proyecto distinto del dispositivo conectado | Error |
| Tamaño del paquete mayor que el espacio libre | Error |
| Formato de audio no soportado por la placa | Error |
| Relé con conmutaciones más rápidas que su intervalo mínimo | Aviso |
| Consumo estimado de LEDs superior a la fuente declarada | Aviso |
| Salida definida que no aparece en ninguna pista ni escena | Aviso |
| Show sin disparador | Aviso |

Los errores bloquean la subida; los avisos se muestran y se pueden aceptar.

## 6. Flujo de subida

1. Validar.
2. Compilar y calcular hash.
3. Comparar con el hash activo en el dispositivo (si coincide, no hay nada que subir).
4. Subir y esperar la verificación del dispositivo.
5. Activar. Si hay un show en marcha, elegir entre esperar al final del pase o pararlo.
6. Mostrar confirmación, con botón de vuelta atrás a mano.

## Tareas

- [ ] `core`: comandos, inversos y pruebas unitarias.
- [ ] `server`: carga y guardado del proyecto, WebSocket, cliente HTTP/WS del dispositivo.
- [ ] Pantalla Piezas: tabla de asignación, "Identificar" y cadena de LEDs.
- [ ] Duplicar proyecto.
- [ ] Línea de tiempo: pistas, clips, zoom, audio.
- [ ] Pantalla Escenas.
- [ ] Pantalla Dispositivo: modo prueba, calibración, subida.
- [ ] Informe de validación.
- [ ] Importar el JSON escrito a mano en la fase 2.

## Criterios de aceptación

- Recrear el show de la fase 2 desde cero solo con el editor.
- Deshacer y rehacer funcionan para todos los comandos.
- Renombrar una salida no rompe ninguna referencia.
- Conectar una pieza a otro relé es cambiar un solo campo; el show no se toca.
- Intercambiar dos edificios en una tira no obliga a retocar el show.
- Añadir un edificio nuevo a una tira y darle luz en el show, sin tocar la RPi, en menos de cinco minutos.
- Con el dispositivo apagado, todo salvo la pantalla Dispositivo sigue funcionando.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| La línea de tiempo se come todo el plazo | Primera versión funcional y fea; pulir después de Navidad |
| Compilar tarda demasiado en shows largos | Compilar en un hilo aparte y solo al cambiar |
| Estado duplicado entre interfaz y servidor | La interfaz no modifica el proyecto: solo envía comandos |
