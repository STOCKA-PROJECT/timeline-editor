# Belén automatizado · Plan unificado

**Versión 2 · 11 de octubre de 2026.** Sustituye a los siete documentos de la carpeta `original/`, que se conservan como referencia. Este plan parte de lo que ya existe en los tres repositorios de Stocka en lugar de diseñar desde cero.

## 0. Qué cambia respecto al plan original

| Plan original (`original/`) | Este plan | Por qué |
|---|---|---|
| Monorepo nuevo `belen/` con React, Node y CLI en TypeScript | Se mantienen los tres repos actuales: `backend` (Spring Boot), `timeline-editor` (Nuxt) y `rpi4-system` (Python) | El editor, el modelo de datos y el reproductor ya existen y funcionan; un cuarto stack no aporta nada |
| Compilar el show a fotogramas binarios a 30 fps | Timeline de eventos con fundidos interpolados en el dispositivo, con semántica escrita | Para cuatro tiras, relés y audio sobra; el reproductor actual ya es de eventos. Lo que falta es fijar la semántica, no cambiar el modelo |
| Reproductor nuevo escrito desde cero | Se conservan los controladores de `rpi4-system` y se reescribe solo `core.py` | Los controladores suman unas 3.000 líneas probadas una temporada entera |
| Salidas definidas como tipos fijos en un `project.json` local | Los **puertos** de Stocka ganan un `kind` cerrado; las acciones se validan contra un catálogo compartido | El contrato de hardware no puede depender de nombres libres que nadie garantiza que existan en el dispositivo |
| Subida al belén desde el navegador por WiFi | Primero una CLI local; después el dispositivo descarga el show desde la nube | El editor desplegado va por HTTPS en Cloudflare Workers y el navegador no puede llamar a `http://belen1.local` |
| MCP, simulador, ESP32 y Bluetooth dentro del calendario de Navidad | Después de Navidad | Ninguno es necesario para montar en diciembre |

Lo que se conserva del plan original: la nomenclatura por IDs lógicos, el mapa de hardware separado del show, el estado seguro, la subida atómica con vuelta atrás, el modo prueba y la idea de que el reproductor no interpreta el proyecto, solo ejecuta.

## 1. Objetivo y punto de corte

Diseñar el show en el editor de Stocka y llevarlo al belén sin tocar código ni meterse debajo de la mesa. El controlador de este año es la Raspberry Pi 4B con `rpi4-system`.

**Punto de corte: 1 de noviembre.** Al terminar la fase 2 el belén reproduce un show exportado desde el editor y se actualiza por red. Todo lo que venga después mejora el proceso pero no condiciona la Navidad.

## 2. Estado actual

### 2.1 `backend` (Spring Boot 4, Java 25, MariaDB)

- Organizaciones con roles, piezas, tipos de pieza, ubicaciones, adjuntos en R2, importación y exportación, contactos, notificaciones.
- **Tipos de pieza con acciones** (`piece_type_actions`): nombre, nombre visible y una lista de parámetros tipados con los flags `dynamic` (lo rellena el clip), `staticValue` (fijo) e `isDuration` (es la duración del clip). Función opcional por organización (`pieceTypeActionsEnabled`).
- **Puertos** (`ports`): nombre único por organización, tipo de pieza, `pin` (único por organización, puede ser nulo), posición y parámetros. Endpoints en `/organizations/{orgSlug}/ports`. Función opcional por organización (`portsEnabled`).
- **Timelines** con documento de escena JSON versionado: `/organizations/{orgSlug}/timelines` y `/{timelineId}/scene` con control de versión optimista.

### 2.2 `timeline-editor` (Nuxt 4, Pinia, Konva)

- Tablero con capas, piezas colocadas (`items`) con sus puertos asignados, una pista por pieza, clips con acción de tipo de pieza y valores de parámetros, reproducción con cursor, deshacer y rehacer, autoguardado.
- `app/utils/exportBundle.ts` genera un **plan de ejecución**: piezas con sus puertos resueltos a pin, y una lista ordenada de pasos con `startMs`, `durationMs`, nombre de acción y parámetros ya materializados (el parámetro `isDuration` toma la duración del clip en segundos).
- Se abre desde el frontend principal con un ticket de handoff y habla con el backend a través de su BFF. En producción se despliega en Cloudflare Workers; en desarrollo corre en el portátil (`nuxt dev`, puerto 3001).

### 2.3 `rpi4-system` (Python 3, RPi.GPIO, rpi-ws281x, python-vlc)

- Controladores: `RelayController`, `LedsController` (tiras y segmentos con nombre, fundidos y animaciones), `AngelController` (motor con sensor IR), `AudioController`, `VideoController` (foco proyectado), `ButtonController` (modos `once`, `loop` y `pulse` con ciclos).
- Configuración en `storage/configs/`: `default.json` (pulsador y cuatro tiras con DMA y canal) y `2026.json` con `config` (`pins` por número de GPIO, `leds` con segmentos `strip/first/last`, `mode_on`, `cicles`) y `timeline` (lista de `{time, name | controller, action, params}` en segundos).
- `core.py` ejecuta los eventos en orden con esperas, resuelve el controlador a partir del nombre del dispositivo y llama a la acción por reflexión. Servicio systemd. Funcionó toda la temporada 2025-26.
- Sin API de red: la configuración se edita en el propio dispositivo.

### 2.4 Hueco a cubrir

El plan de ejecución del editor y el formato de `rpi4-system` describen lo mismo con dos vocabularios distintos y sin ningún esquema entre ambos. No hay forma de llevar un show del editor al belén salvo a mano, ni de saber si una acción del editor existe en el dispositivo.

## 3. Arquitectura objetivo

```
        Nube (Cloudflare / stocka.xeye.es)                   Casa / local de la asociación
┌───────────────────────────────────────────────┐    ┌───────────────────────────────────────┐
│  backend (Spring Boot)                        │    │  Portátil                             │
│   piezas · tipos · acciones · puertos         │◄───┤   navegador → editor (Workers)        │
│   timelines · escenas · [fase 6: releases]    │    │   belen-cli deploy show.json  ───┐    │
│                                               │    │                                  │    │
│  timeline-editor (Workers)                    │    │  Raspberry Pi 4B   belen1.local  ▼    │
│   escena → plan de ejecución → paquete v2     │    │   rpi4-system: API · loader · core    │
└───────────────────────────────────────────────┘    │   relés · tiras · audio · ángel · foco │
                   [fase 6: la RPi descarga el ──────►│                                       │
                    paquete publicado con su token]   └───────────────────────────────────────┘
```

Tres principios:

1. **El show es un paquete de datos con esquema; el reproductor es genérico.** Cambiar el show nunca implica tocar código en la RPi.
2. **Un solo contrato.** El catálogo de tipos de salida y acciones es el mismo fichero para el backend, el editor y la RPi. Si el editor ofrece una acción, el dispositivo la ejecuta.
3. **El dispositivo solo necesita salida a internet o la red local; nunca entrada.** El navegador no habla con la RPi; lo hace una CLI en el portátil (fase 3) o la propia RPi descargando de la nube (fase 6).

## 4. El contrato: catálogo y paquete de show

Esta sección es la referencia del proyecto. Vive en `rpi4-system/contract/` (esquema JSON y catálogo) y se copia, no se reinterpreta, en el backend y en el editor.

### 4.1 Catálogo de tipos de salida (`kind`)

Cada puerto de Stocka pasa a tener un `kind` cerrado. Las acciones y parámetros de cada `kind` son los que ya implementan los controladores de `rpi4-system`; los nombres se respetan tal cual para que el cargador sea directo.

| `kind` | Controlador | Configuración del puerto | Acciones y parámetros |
|---|---|---|---|
| `relay` | `RelayController` | `pin` (GPIO BCM o `exp1:n` a partir de la fase 4), `activeLow` | `turn_on(time?)`, `turn_off(time?)`, `focoOn(hold_time?)`, `focoOff(hold_time?, pulse_delay?)` |
| `led_strip` | `LedsController` | `pin`, `dma`, `channel`, `pixels`, `brightness` | `setBrightness(brightness)`, `clear()` |
| `led_segment` | `LedsController` | `strip` (nombre de un `led_strip`), `first`, `last` | `fill(color)`, `fade(color, duration)`, `animate(animation_type, color?, from_color?, duration?, speed?, intensity?)`, `clear()` |
| `motor` | `AngelController` | `pinR`, `pinL`, `sensorPin`, `maxUpTime` | `start_up(time?, up_time?)`, `start_down(time?)`, `stop()` |
| `audio` | `AudioController` | — | `play(audio_name, time?)`, `stop()` |
| `video` | `VideoController` | — | `play(video_name)`, `stop()` |
| `button` (entrada) | `ButtonController` | `pin`, `mode` (`once`, `loop`, `pulse`), `cycles` | — |

Reglas:

- Un tipo de pieza declara qué `kind` controla. Sus acciones se eligen del catálogo de ese `kind`, con el nombre fijo; lo que sigue siendo libre es el nombre visible, qué parámetros son `dynamic` y cuál es `isDuration`.
- El parámetro `isDuration` del editor se vuelca en `time` o `duration` según la acción.
- Una acción que no esté en el catálogo del `kind` del puerto es un error de validación en el backend y en el editor, no un aviso en el log de la RPi.
- `animation_type` admite los nombres que ya existen en `LedsController`: `stars`, `fire`, `window_light`, `candle`, `sunrise`, `sunset`, `moonlight`, `clouds`, `shooting_star`, `aurora`, `snow`.

### 4.2 Paquete de show (`stocka-show` v2)

Un único JSON. Lo genera el editor a partir del plan de ejecución y lo valida la RPi antes de activarlo.

```json
{
  "format": "stocka-show",
  "version": 2,
  "meta": { "name": "Belén 2026", "timelineId": 12, "exportedAt": "2026-10-20T18:00:00Z", "hash": "sha256:…" },
  "board": "rpi4b",
  "mode": { "on": "pulse", "cycles": 1 },
  "hardware": {
    "LedStrip3":   { "kind": "led_strip",   "pin": 13, "dma": 10, "channel": 1, "pixels": 300 },
    "Fondo1":      { "kind": "led_segment", "strip": "LedStrip3", "first": 0, "last": 148 },
    "Focos":       { "kind": "relay",       "pin": 27 },
    "Sembra":      { "kind": "relay",       "pin": 26 },
    "Angel":       { "kind": "motor",       "pinR": 3, "pinL": 4, "sensorPin": 7, "maxUpTime": 18 },
    "Audio":       { "kind": "audio" },
    "Pulsador":    { "kind": "button",      "pin": 20 }
  },
  "timeline": [
    { "t": 0,     "target": "Focos",  "action": "focoOn",  "params": {} },
    { "t": 0,     "target": "Fondo1", "action": "fill",    "params": { "color": [255, 50, 0] } },
    { "t": 0,     "target": "Audio",  "action": "play",    "params": { "audio_name": "nature.mp3" } },
    { "t": 7000,  "target": "Sembra", "action": "turn_on", "params": { "time": 20 } },
    { "t": 60000, "target": "Angel",  "action": "start_up", "params": {} },
    { "t": 90000, "target": "Fondo1", "action": "fade",    "params": { "color": [0, 16, 64], "duration": 15 } }
  ],
  "durationMs": 118000,
  "assets": { "audio": ["nature.mp3"], "video": [] }
}
```

Decisiones de formato:

- **`target` es el nombre del puerto** en Stocka, único por organización. Es el mismo valor que hoy usa `rpi4-system` como `name`, así que el cargador no necesita tabla de traducción.
- **Tiempos en milisegundos enteros** en el paquete (`t`, `durationMs`), que es lo que usa el editor. El cargador convierte a segundos para los controladores. Los parámetros `time`, `duration` y `hold_time` se mantienen en segundos porque así los esperan los controladores.
- **`hardware` sustituye a `config.pins` y `config.leds`** del formato actual. Los segmentos van al mismo nivel que las tiras, cada uno con su `kind`.
- **`mode` sustituye a `mode_on` y `cicles`.**
- Los ficheros de audio y vídeo viajan aparte (fase 3) y se comprueba que existen antes de activar.
- `meta.hash` es el SHA-256 del paquete sin el propio campo `hash`. Mismo show, mismo hash.

### 4.3 Semántica de tiempo

Escrita una vez para que la vista previa del editor y la RPi hagan lo mismo:

- Un evento se dispara cuando el reloj del ciclo supera `t`. Si el sistema va tarde, se ejecutan de inmediato los eventos atrasados; nunca se acumula espera.
- `fill` es instantáneo. `fade` interpola linealmente en RGB desde el color actual hasta `color` durante `duration` segundos. `animate` corre hasta que otro evento sobre el mismo `target` la sustituye o hasta `duration` si se indica.
- Dos eventos sobre el mismo `target` se aplican en orden de `t`; a igual `t`, en orden de lista. El editor garantiza ese orden al exportar.
- `turn_on` con `time` apaga solo a los `time` segundos. Sin `time`, queda encendido hasta un `turn_off`.
- El ciclo termina en `durationMs`. Al terminar, el reproductor espera a que acaben los procesos en marcha (motor, audio) y pasa a reposo. El estado de reposo es "todo apagado" hasta que exista el evento `idle` (fase 5).

### 4.4 Validaciones del paquete

Se aplican en el editor al exportar y en la RPi al cargar. Las mismas reglas, los mismos mensajes.

| Regla | Nivel |
|---|---|
| `format`, `version` y `board` reconocidos | Error |
| Todo `target` existe en `hardware` | Error |
| La acción está en el catálogo del `kind` del `target` y sus parámetros tienen el tipo esperado | Error |
| `pin` duplicado o reservado en la placa (`boards/rpi4b.json`) | Error |
| Segmento fuera del rango de su tira, o tira inexistente | Error |
| Fichero de audio o vídeo referenciado que no se ha subido | Error |
| Dos eventos solapados con la misma acción continua sobre el mismo `target` (dos `animate`) | Aviso |
| Puerto definido en `hardware` sin ningún evento | Aviso |
| `t` mayor que `durationMs` | Error |

### 4.5 Nomenclatura

- Los nombres de puerto son el ID lógico. Se recomiendan nombres de pieza, no de pin: `Sembra`, `CasaDoble`, `Fondo1`. Renombrar un puerto en Stocka actualiza las escenas que lo usan (comando en el backend; ver fase 1).
- Las direcciones físicas solo aparecen en `hardware`. A partir de la fase 4, `pin` admite `"exp1:3"` para canales del expansor además del número de GPIO.
- Los nombres de acción son los del catálogo, en `snake_case` o tal como existan ya en el controlador (`focoOn` se mantiene por compatibilidad).

## 5. Fases

### Fase 1 · Contrato y conversor · 12–18 de octubre

**Objetivo.** Que el editor exporte un paquete `stocka-show` v2 válido y que exista un único catálogo compartido.

**`rpi4-system`**

- [ ] `contract/catalog.json`: tipos de salida, acciones y parámetros de la tabla 4.1, generado o verificado contra los controladores con un test.
- [ ] `contract/show.schema.json`: esquema JSON del paquete 4.2.
- [ ] `boards/rpi4b.json`: pines válidos y reservados (los GPIO bajos con resistencia a positivo, SPI, I2C).

**`backend`**

- [ ] `Port.kind` (enum) y `Port.config` (JSON por `kind`) con migración Flyway; los puertos existentes se migran como `relay` o `led_strip` según su tipo de pieza.
- [ ] `PieceType.kind` opcional; al crear o editar una acción se valida contra `catalog.json`.
- [ ] Renombrar un puerto actualiza las referencias en las escenas de la organización.
- [ ] Bruno: casos de puerto por `kind` y de acción rechazada.

**`timeline-editor`**

- [ ] `app/utils/showPackage.ts`: plan de ejecución → paquete v2, con `hardware` a partir de los puertos de la organización, `timeline` ordenado por `t` y `hash`.
- [ ] Validador con las reglas de 4.4; los errores bloquean la exportación, los avisos se muestran.
- [ ] El botón de exportar descarga el paquete v2 (el bundle actual queda como copia de seguridad del documento).
- [ ] Test unitario: el show de 2025-26 reconstruido en el editor exporta un paquete equivalente al `2026.json` actual.

**Aceptación.** Un show hecho en el editor se exporta sin errores; copiado a mano a la RPi y cargado por el nuevo cargador (fase 2), se reproduce igual que en la vista previa.

### Fase 2 · Reproductor: cargador, núcleo y API · 19 de octubre – 1 de noviembre

**Objetivo.** La RPi carga paquetes v2, los ejecuta de forma fiable y se gestiona por red. Es el punto de corte.

**Estructura resultante de `rpi4-system`**

```
app/
  core/
    loader.py        # abre el paquete, valida con show.schema.json, construye el hardware
    clock.py         # reloj del ciclo
    scheduler.py     # dispara eventos por reloj, nunca por espera acumulada
    state.py         # BOOT → SAFE → IDLE ⇄ PLAYING ; TEST ; ERROR → SAFE
    core.py          # orquestación (reescrito, ~mismo tamaño)
  api/
    server.py        # HTTP + WebSocket (aiohttp o FastAPI)
  storage.py         # shows/<hash>/, active, previous, incoming/
  modules/           # los controladores actuales, sin cambios funcionales
contract/            # catálogo y esquema (fase 1)
boards/
```

**Máquina de estados**

| Estado | Qué ocurre |
|---|---|
| `BOOT` | Primero todas las salidas en seguro; después se carga el show activo |
| `SAFE` | Relés apagados, motor parado, tiras a negro, audio y vídeo parados |
| `IDLE` | Reposo; se atiende el pulsador y la API |
| `PLAYING` | Reproducción por reloj; el pulsador se ignora; la API solo puede parar |
| `TEST` | Control manual desde la API; solo desde `IDLE`; cada orden caduca sola |
| `ERROR` | Se registra la causa, se pasa a `SAFE` y se intenta volver a `IDLE` |

**API** (token fijo en cabecera, solo red local)

| Método | Ruta | Función |
|---|---|---|
| GET | `/api/info` | Placa, versión, hash del show activo, espacio libre, catálogo soportado |
| GET | `/api/status` | Estado, tiempo de ciclo, entradas, último error |
| PUT | `/api/shows/{hash}` | Sube un paquete a `incoming/`; valida; lo guarda |
| PUT | `/api/shows/{hash}/assets/{name}` | Sube un fichero de audio o vídeo del paquete |
| POST | `/api/shows/{hash}/activate` | Lo activa de forma atómica; el anterior pasa a `previous` |
| POST | `/api/rollback` | Vuelve a `previous` |
| POST | `/api/play`, `/api/stop`, `/api/panic` | Control de reproducción |
| POST | `/api/test/set`, `/api/test/release` | Modo prueba (fase 5 lo completa) |
| GET | `/api/logs` | Últimos registros |
| WS | `/api/live` | Estado continuo |

**Tareas**

- [ ] `loader.py` con validación contra el esquema y construcción de `pins` y `leds` para los controladores actuales (conversión v2 → estructuras que ya entienden).
- [ ] `scheduler.py` por reloj; `_calculate_timeline_duration` deja de hacer falta porque `durationMs` viene en el paquete.
- [ ] `state.py` y estado seguro en arranque, parada, excepción y `panic`.
- [ ] `storage.py` con subida atómica (`incoming/` → `shows/<hash>/` → enlace `active`) y `previous`.
- [ ] `api/server.py` con las rutas de la tabla y token.
- [ ] Modo simulado de los controladores (escriben a log en vez de a GPIO) para probar el núcleo en el portátil. `ws281x_mock.py` ya existe; extenderlo a relés, motor y audio.
- [ ] Servicio systemd actualizado; nombre `belen1.local` por mDNS; la RPi se une a las redes conocidas y, si no hay, crea `belen-setup`.
- [ ] Tests: paquete válido se activa; paquete corrupto o de otra placa se rechaza y sigue el anterior; corte de corriente a mitad de show arranca en `IDLE` con todo apagado.

**Aceptación.** 20 pases seguidos sin desfase apreciable entre audio y luces. El show de 2025-26, exportado desde el editor, se reproduce en el belén sin tocar la RPi.

### Fase 3 · Canal de subida · 2–8 de noviembre

**Objetivo.** Llevar el paquete del portátil a la RPi con un comando, y desde el editor cuando el editor corre en el portátil.

**Por qué una CLI y no el navegador.** El editor en producción se sirve por HTTPS desde Cloudflare Workers. Un navegador no puede hacer peticiones HTTP a `belen1.local` desde una página HTTPS (contenido mixto) y, aunque pudiera, Chrome bloquea el acceso a la red privada desde orígenes públicos. La CLI corre en el portátil y sí llega a la red local.

**`rpi4-system/cli/`** (Python, mismo repo que el reproductor para compartir el contrato)

- [ ] `belen deploy show.json --host belen1.local`: valida en local, sube el paquete y sus ficheros, activa y muestra el estado. Si el hash ya está activo, no sube nada.
- [ ] `belen status`, `belen rollback`, `belen logs`, `belen stop`, `belen panic`.
- [ ] `belen deploy --wait`: si hay un pase en marcha, espera a que termine antes de activar.
- [ ] Fichero `~/.belen/config` con host y token.

**`timeline-editor`**

- [ ] Pantalla **Dispositivo**, activa solo cuando el editor corre en `localhost` (desarrollo o build local): conectar, ver estado, subir y activar a través del BFF (el servidor Nitro del portátil sí llega a la red local).
- [ ] En el editor desplegado, la misma pantalla muestra las instrucciones de la CLI y el comando ya montado con el nombre del fichero exportado.

**Aceptación.** Desde el editor: exportar, `belen deploy`, pulsar el botón del belén. Menos de dos minutos y sin tocar la RPi.

### Fase 4 · Banco y hardware nuevo · en paralelo, 12 de octubre – 1 de noviembre

No bloquea las fases 1 a 3. Lo único realmente nuevo es el expansor de relés.

- [ ] **Expansor MCP23017 por I2C.** Driver `drivers/mcp23017.py` y soporte en `RelayController` para direcciones `exp1:n`. Confirmar si la placa de relés es activa a nivel bajo y qué hace al arrancar: ningún relé debe activarse solo.
- [ ] **Pines nativos.** Anotar en `boards/rpi4b.json` los GPIO que arrancan a nivel alto y los reservados por SPI, I2C y PWM.
- [ ] **Tiras con audio a la vez.** Comprobar en banco que las cuatro tiras (DMA 7, 8 y 10) no interfieren con el audio; si lo hacen, mover la tira a SPI.
- [ ] **Consumo de LEDs** con todo en blanco; dimensionar fuente e inyección (hasta 60 mA por píxel).
- [ ] **Ángel.** Medir subida y bajada varias veces; fijar `maxUpTime` en 1,3 veces la subida más lenta. Probar con el sensor desconectado: el motor debe parar por tiempo.
- [ ] **Foco.** Medir el retardo entre `focoOn` y la imagen; comprobar que `VideoController` arranca sin escritorio.

### Fase 5 · Robustez y modo prueba · 9–22 de noviembre

- [ ] Modo prueba completo: activar o regular cualquier `target` por nombre, elegir color en un segmento, mover el ángel manteniendo la orden (caduca a los 500 ms). Toda orden caduca a los 60 s.
- [ ] **Identificar**: `belen identify Sembra` enciende tres segundos esa salida para saber qué pieza responde tras cablear.
- [ ] Evento `idle` en el paquete: estado de reposo entre pases (por ejemplo casas tenues).
- [ ] Vigilancia: watchdog de systemd y reinicio automático; `panic` por pulsación larga del botón físico.
- [ ] Calibración del foco desde la CLI: posición y radio arriba y abajo.
- [ ] Horario opcional: horas en las que el belén atiende el pulsador.
- [ ] Editor: vista previa fiel a la semántica 4.3 para `fill`, `fade`, `turn_on` con `time` y motor con tiempos medidos. Las animaciones se muestran como color medio.

### Fase 6 · Publicación desde la nube · 23 de noviembre – 6 de diciembre (o después de Navidad si aprieta)

**Objetivo.** Que "Enviar al belén" funcione desde el editor desplegado, sin CLI, publicando el paquete en Stocka y dejando que la RPi lo descargue. Encaja con el producto: una asociación tiene varias personas editando y un dispositivo por belén.

**`backend`**

- [ ] `devices`: alta de dispositivo por organización, token de dispositivo, última conexión, show activo.
- [ ] `POST /organizations/{orgSlug}/timelines/{id}/releases`: el editor publica el paquete v2 y sus ficheros (R2). `GET /devices/me/release`: la RPi consulta con su token si hay un release nuevo para ella.
- [ ] Estado del dispositivo visible en Stocka: en línea, show activo, último error.

**`rpi4-system`**

- [ ] `pull.py`: sondeo periódico del backend con el token; descarga, valida y activa con las mismas rutas internas que la API local.
- [ ] Emparejamiento inicial por CLI: `belen pair --org asociacion --code 123456`.

**`timeline-editor`**

- [ ] Botón "Publicar en el belén" que crea el release y muestra cuándo lo ha recogido el dispositivo.

**Aceptación.** Publicar desde el editor en la nube; en menos de un minuto el belén reproduce el nuevo show, sin portátil en la red local.

### Fase 7 · Después de Navidad

En este orden, cada una justificada por lo que se haya echado en falta en diciembre:

1. **Aplicar el brandbook de Stocka al editor** (sistema de diseño en https://claude.ai/artifact/PiCF8nnF1bfZCSqS9KH2Q7): tokens, densidades de tabla, tipografías.
2. **Capa de comandos y MCP.** El editor ya tiene deshacer por instantáneas; el MCP del plan original (`original/04-servidor-mcp.md`) necesita comandos con nombre. Se diseña entonces, sobre el BFF del editor.
3. **Simulador con foto de fondo y audio como reloj** (`original/05-simulador-vista-previa.md`).
4. **Segundo belén con ESP32 y Bluetooth** (`original/06-futuro-esp32-arduino-ble.md`): perfil `esp32-devkit`, mismo paquete, cargador en C++. El contrato de la sección 4 ya lo permite: ningún pin fuera de `hardware`, paquete en ficheros planos, mensajes independientes del transporte.
5. Varios dispositivos por organización sincronizados.

## 6. Calendario

| Semana | Fechas | Fase | Hito |
|---|---|---|---|
| 1 | 12–18 oct | 1 · Contrato y conversor | El editor exporta un paquete v2 válido |
| 2–3 | 19 oct – 1 nov | 2 · Reproductor | **Punto de corte**: el belén reproduce un show del editor y se actualiza por red |
| 1–3 | 12 oct – 1 nov | 4 · Banco (en paralelo) | Expansor y hardware nuevo probados |
| 4 | 2–8 nov | 3 · Canal de subida | `belen deploy` y pantalla Dispositivo |
| 5–6 | 9–22 nov | 5 · Robustez | Modo prueba, identificar, reposo, watchdog |
| 7–8 | 23 nov – 6 dic | 6 · Nube | Publicar desde el editor desplegado |
| — | 6–8 dic | Montaje | |

Si el calendario aprieta, se cae primero la fase 6 (la CLI ya cubre la subida) y después la mitad final de la fase 5. Las fases 1 a 3 no se recortan.

## 7. Reparto por repositorio

| Repo | Fase 1 | Fase 2 | Fase 3 | Fase 5 | Fase 6 |
|---|---|---|---|---|---|
| `backend` | `kind` y `config` en puertos; validación de acciones; renombrado en escenas | — | — | — | dispositivos, releases, estado |
| `timeline-editor` | `showPackage.ts`, validador, exportar v2 | — | pantalla Dispositivo (local) | vista previa fiel | botón Publicar |
| `rpi4-system` | `contract/`, `boards/` | loader, scheduler, estados, storage, API, systemd | `cli/` | modo prueba, identify, idle, watchdog | `pull.py`, pair |

## 8. Riesgos

| Riesgo | Mitigación |
|---|---|
| Los nombres de acción de los tipos de pieza en Stocka no coinciden con los controladores | Fase 1 los fija por catálogo; migración que renombra las existentes y avisa de las que no encajan |
| Reescribir `core.py` rompe algo que funcionaba | Modo simulado y test de equivalencia: el `2026.json` actual, convertido a v2, produce la misma secuencia de llamadas a controladores |
| Desfase de audio con los minutos | Reloj del ciclo basado en la posición del reproductor de audio cuando hay audio (`AudioController` ya expone estado) |
| Tarjeta SD corrupta por cortes de corriente | Escrituras mínimas; `active` y `previous` como enlaces; valorar sistema de ficheros de solo lectura con partición de datos |
| Motor en marcha con el proceso bloqueado | Orden con caducidad en el driver; watchdog; cablear el final de carrera para que corte por hardware |
| El editor desplegado no llega a la red local | Asumido: CLI en fase 3 y descarga desde la nube en fase 6 |
| Sin internet en el local de la asociación | La CLI por red local sigue funcionando; la fase 6 es un añadido, no un sustituto |
| Las funciones opcionales `portsEnabled` y `pieceTypeActionsEnabled` están apagadas en la organización | Activarlas en la organización del belén antes de la fase 1 |

## 9. Decisiones que hay que cerrar antes de empezar

- **Nombres de acción.** Confirmar que las acciones de los tipos de pieza actuales se pueden renombrar a los del catálogo (`turn_on`, `fill`, `fade`, `animate`, `start_up`, `play`...). Si hay acciones que no encajan en ningún `kind`, decidir si se eliminan o si se añade la acción al controlador.
- **Fecha real de montaje.** El calendario supone el puente del 6 al 8 de diciembre.
- **Audio en la RPi.** Jack o tarjeta USB; se decide en el banco con las tiras funcionando.
- **Internet en el local.** Condiciona si la fase 6 entra antes de Navidad o después.
- **Nombre del dispositivo.** `belen1.local` por defecto; si hay dos belenes, `belen2.local`.
