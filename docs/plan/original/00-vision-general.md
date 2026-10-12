# Belén automatizado · Visión general

Documento índice. Resume la arquitectura, fija la nomenclatura común a todos los controladores y enlaza el plan detallado de cada fase.

## 1. Objetivo

Diseñar y previsualizar en el portátil el flujo ("show") del belén y enviarlo de forma inalámbrica al controlador, sin tocar código ni acceder físicamente al dispositivo. El primer controlador es una Raspberry Pi 4B; más adelante habrá un segundo belén con ESP32 o Arduino que debe usar el mismo editor, el mismo formato y los mismos nombres.

## 2. Documentos

| Fichero | Fase | Duración | Resultado |
|---|---|---|---|
| `01-formato-compilador-y-banco.md` | 1 | 1 semana | Formato del show, compilador y hardware nuevo probado en banco |
| `02-reproductor-rpi.md` | 2 | 2 semanas | El belén funciona y se actualiza por WiFi |
| `03-editor-minimo.md` | 3 | 2–3 semanas | Editor web con tabla de piezas y salidas, línea de tiempo y subida |
| `04-servidor-mcp.md` | 4 | 3–4 días | Claude edita el proyecto y se ve en vivo |
| `05-simulador-vista-previa.md` | 5 | 1–2 semanas | Vista previa 2D sin el belén delante |
| `06-futuro-esp32-arduino-ble.md` | 6 | Después de Navidad | Segundo controlador y Bluetooth |

## 3. Arquitectura

```
Portátil                                      Belén
┌────────────────────────────┐    WiFi     ┌─────────────────────────┐
│ Interfaz web (React)       │   HTTP/WS   │ Reproductor (RPi)       │
│        ▲ WebSocket         │ ──────────► │ API · reloj · drivers   │
│ Servidor local (Node)      │             └────────────┬────────────┘
│  comandos · compilador     │                          │
│  simulador · MCP ◄─ Claude │      relés · LEDs · audio · ángel · proyector
└────────────────────────────┘
```

Tres principios que condicionan todo lo demás:

1. **El show es un fichero de datos; el reproductor es genérico.** Cambiar el flujo nunca implica tocar el código del controlador.
2. **Editor listo, reproductor tonto.** El editor compila el show a fotogramas (valor de cada canal a 30 fps) más una lista corta de eventos. El reproductor solo los ejecuta, y el simulador reproduce exactamente los mismos datos.
3. **Una sola capa de comandos.** Toda modificación del proyecto es un comando. La interfaz y el MCP usan los mismos, así que lo que hace Claude aparece en pantalla y se puede deshacer.

## 4. Nomenclatura común

Esta sección es la referencia para todo el proyecto. El objetivo es que un belén con RPi y otro con ESP32 o Arduino se describan igual, cambiando solo el perfil de placa y los números de pin.

### 4.1 Tres niveles

| Nivel | Qué describe | Cambia entre placas |
|---|---|---|
| `board` | Perfil de la placa: pines válidos, pines reservados, capacidades | Sí, por definición |
| `ports` | Recursos físicos: expansores, tiras, audio, vídeo | Solo los pines |
| `outputs` / `inputs` | Elementos del belén con nombre | No |

El show (escenas, línea de tiempo, disparadores) solo usa IDs lógicos de `outputs` e `inputs`. Nunca aparece un pin.

### 4.2 IDs lógicos

Formato: `<tipo>.<nombre-en-minusculas-con-guiones>`

| Prefijo | Significado | Ejemplo |
|---|---|---|
| `relay.` | Salida todo/nada | `relay.herrero` |
| `dimmer.` | Salida regulable (PWM) | `dimmer.luna` |
| `led.` | Segmento de tira direccionable | `led.casa-herrero` |
| `motor.` | Motor con sentido y límites | `motor.angel` |
| `audio.` | Salida de sonido | `audio.principal` |
| `spot.` | Foco proyectado | `spot.angel` |
| `button.` | Pulsador | `button.inicio` |
| `sensor.` | Final de carrera o detector | `sensor.angel-arriba` |
| `group.` | Conjunto de salidas | `group.casas` |
| `scene.` | Estado con nombre | `scene.noche` |

### 4.3 Puertos y direcciones físicas

Puertos, con ID `<tipo><n>`: `exp1` (MCP23017), `strip1` (WS2812B), `audio1`, `video1`. El puerto `gpio` existe siempre y representa los pines nativos.

Dirección física (campo `at`):

| Forma | Significado |
|---|---|
| `gpio:17` | Pin nativo. Número BCM en RPi, número GPIO en ESP32, número de pin digital en Arduino (`gpio:A0` para analógicos) |
| `exp1:3` | Canal 3 (0–15) del expansor `exp1` |
| `strip1:0-5` | Píxeles 0 a 5 de la tira `strip1` |
| `audio1`, `video1` | El puerto completo |

### 4.4 El mismo belén en dos placas

Contenido de la sección `hardware` del proyecto (el resto de secciones está en `01-formato-compilador-y-banco.md`):

```json
{
  "board": "rpi4b",
  "ports": {
    "exp1":   { "type": "mcp23017", "addr": "0x20" },
    "strip1": { "type": "ws2812b", "pin": "gpio:10", "pixels": 120 },
    "audio1": { "type": "audio" },
    "video1": { "type": "video" }
  },
  "outputs": {
    "relay.herrero":    { "type": "relay", "at": "exp1:3", "activeLow": true },
    "led.casa-herrero": { "type": "led",   "at": "strip1:0-5" },
    "audio.principal":  { "type": "audio", "at": "audio1" },
    "motor.angel":      { "type": "motor", "at": { "in1": "gpio:23", "in2": "gpio:24" },
                          "limitUp": "sensor.angel-arriba", "maxRunMs": 9000 },
    "spot.angel":       { "type": "spot",  "at": "video1", "follows": "motor.angel" }
  },
  "inputs": {
    "button.inicio":       { "type": "button", "at": "gpio:17" },
    "sensor.angel-arriba": { "type": "sensor", "at": "gpio:27" }
  }
}
```

Para pasarlo a un ESP32 solo cambia esto:

| Campo | RPi 4B | ESP32 |
|---|---|---|
| `board` | `rpi4b` | `esp32-devkit` |
| `strip1.pin` | `gpio:10` | `gpio:16` |
| `motor.angel.at` | `gpio:23`, `gpio:24` | `gpio:25`, `gpio:26` |
| `button.inicio.at` | `gpio:17` | `gpio:32` |
| `sensor.angel-arriba.at` | `gpio:27` | `gpio:33` |
| `video1`, `spot.angel` | Presentes | Se eliminan (sin vídeo) |

Los relés en `exp1:n`, los segmentos de LED, las escenas y la línea de tiempo quedan idénticos.

### 4.5 Reglas

- Los IDs lógicos son únicos en el proyecto y no se reutilizan entre tipos.
- Renombrar una salida es un comando del editor que actualiza todas las referencias.
- El reproductor rechaza un show cuyo `board` no coincide con el suyo.
- Los mismos nombres se usan en el código de los reproductores: módulos (`loader`, `clock`, `frame_player`, `events`, `inputs`, `drivers`), operaciones de driver (`begin`, `write`, `safe`) y mensajes de protocolo (`show.put`, `play`, `test.set`...).

## 5. Qué pasa cuando cambia el belén

Nada de lo que cambia de un año a otro está en el código. Cada pieza guarda tres datos independientes, y cada uno se cambia por separado desde el portátil:

| Dato de la pieza | Dónde se guarda | Quién lo usa |
|---|---|---|
| Nombre (`relay.herrero`) | `outputs` | El show: escenas y línea de tiempo |
| Salida a la que está conectada (`exp1:3`) | Campo `at` | El reproductor |
| Posición en el belén | `layout` | Solo la vista previa; nunca se envía al dispositivo |

Como el show solo conoce nombres, mover o recablear una pieza no lo rompe.

| Cambio en el belén | Qué se hace en el editor |
|---|---|
| Mover una pieza de sitio sin cambiar su cable | Arrastrarla en la vista previa |
| Conectar una pieza a otro relé o pin | Cambiar su salida en la tabla de piezas |
| Añadir una pieza | Nueva fila en la tabla y colocarla en la vista previa |
| Quitar una pieza | Eliminarla; se quitan también sus pistas (se puede deshacer) |
| Reordenar edificios en una tira o cambiar sus LEDs | Reordenar la cadena; los rangos de píxeles se recalculan solos |
| Añadir otra placa de relés u otra tira | Declarar un puerto nuevo (`exp2`, `strip2`) |
| Cambiar el recorrido del ángel o mover el proyector | Volver a medir los tiempos y calibrar el foco desde la pantalla Dispositivo |
| Cambiar la estructura entera | Duplicar el proyecto, poner la foto nueva de fondo y recolocar las piezas |

En ningún caso se toca el software del controlador ni hay que acceder a él.

**Un proyecto por montaje.** "Belén 2026", "Belén 2027"... Duplicar un proyecto conserva piezas, escenas y show; solo se ajusta lo que haya cambiado.

**El editor no dibuja el hardware.** No representa cableado ni electrónica. Lo único que necesita saber es qué salidas existen (cuántos expansores hay, cuántos LEDs tiene cada tira) para ofrecerlas al asignar y detectar duplicados. Lo que se previsualiza es el belén en acción.

**Lo único manual** es cablear y decirle al editor a qué salida ha quedado conectada cada pieza. Para eso está "Identificar": se activa una salida desde el portátil, se ve qué pieza responde y se asigna.

## 6. Dónde vive cada funcionalidad extra

| Funcionalidad | Diseño | Implementación |
|---|---|---|
| Segmentos y grupos de LED | Fase 1 | Fases 1 y 3 |
| Escenas con fundidos | Fase 1 | Fases 1 y 3 |
| Clip de motor con condición y tiempo máximo | Fase 1 | Fase 2 |
| Estado de reposo y disparadores | Fase 1 | Fase 2 |
| Estado seguro ante fallo | Fase 2 | Fase 2 |
| Subida atómica y vuelta atrás | Fase 2 | Fases 2 y 3 |
| Modo prueba de salidas | Fase 2 | Fases 2 y 3 |
| Estado y registros del dispositivo | Fase 2 | Fases 2 y 3 |
| Validación antes de subir | Fase 1 | Fases 1 y 3 |
| Vista previa 2D con audio como reloj | Fase 5 | Fase 5 |

## 7. Calendario

Fechas supuestas para montar el belén en el puente del 6–8 de diciembre de 2026. Ajústalas si montas en otra fecha.

| Semana | Fechas | Fase |
|---|---|---|
| 1 | 12–18 oct | 1 · Formato, compilador y banco |
| 2–3 | 19 oct – 1 nov | 2 · Reproductor RPi |
| 4–6 | 2–22 nov | 3 · Editor mínimo |
| 7 | 23–26 nov | 4 · MCP |
| 7–8 | 27 nov – 6 dic | 5 · Simulador |

**Punto de corte:** al acabar la fase 2 el belén ya funciona y se actualiza por WiFi con un JSON escrito a mano. Si las fases 3 a 5 se retrasan, la Navidad no depende de ellas.

## 8. Decisiones abiertas

- Lenguaje del reproductor RPi: Python (propuesto, reaprovecha el código del año pasado).
- Salida de audio en la RPi: jack o tarjeta USB (se decide en el banco de la fase 1).
- Fecha real de montaje.
- Placa del segundo belén: ESP32 (recomendado) o Arduino clásico con perfil reducido.
