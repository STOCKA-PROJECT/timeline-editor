# Fase 4 · Banco y hardware 2026

**Replanteada el 20 de octubre de 2026** a partir de las decisiones de Joan. Sustituye a la fase 4 del
[plan unificado](README.md) y absorbe la aceptación con hardware de la fase 2 / A5 pendiente en
[`paquete-offline.md`](paquete-offline.md) §13. Todo lo de software de las fases 1–3, A–D está hecho; lo
que sigue es lo que falta para que el belén de 2026 funcione con el hardware real.

## 0. Qué cambia respecto al plan unificado

| Plan unificado (11-10) | Ahora (20-10) | Por qué |
|---|---|---|
| Expansor MCP23017 "si hace falta", dirección `exp1:n` dentro del `pin` del relé | **Relés estandarizados** y el expansor es un **puerto de infraestructura** (`gpio_expander`) al que los relés se refieren por nombre y canal, como los segmentos a su tira | Decisión de Joan; el patrón tira/segmento ya existe en los tres repos y en los formularios |
| Audio: "jack o tarjeta USB, se decide en el banco" | **Jack**, como en 2025-26. Solo se verifica la configuración de la Pi que ya funcionaba | Confirmado por Joan |
| Ángel: "fijar `maxUpTime` en 1,3 × la subida más lenta" | `maxUpTime` **obligatorio** en el contrato y tope duro en el controlador | Decisión de Joan: debe existir un tiempo máximo de subida |
| Foco proyectado (`video`, `VideoController`, relé `focoOn/focoOff`) | **Se elimina todo** | No se va a usar |
| — | **Cabezal móvil Varytec Hero Wash 712 Z RGBW Zoom** por USB→DMX, especificable y controlable desde el timeline | Nuevo hardware de 2026 |
| Fase 5: "calibración del foco desde la CLI" | Posiciones del cabezal calibradas con el **modo prueba** y guardadas como acciones con valores estáticos del tipo de pieza | El proyector desaparece; la necesidad (apuntar a sitios fijos) se resuelve con lo que Stocka ya tiene |

## 1. Decisiones tomadas (Joan, 20 de octubre)

1. Estandarizar la funcionalidad de los relés y poder direccionar más relés con un MCP23017; los puertos de Stocka deben permitir añadirlos.
2. Audio por el jack de la Pi, como el año pasado; revisar la configuración que funcionaba, no cambiarla.
3. El ángel tiene un tiempo máximo de subida.
4. Fuera todo lo del proyector.
5. El cabezal Varytec se conecta por USB hacia DMX y se controla desde el timeline.

## 2. Contrato v3

Un solo cambio de contrato coordinado en `rpi4-system/contract/` y copiado al backend y al editor: **catálogo v3** y
**`stocka-show` v3**. Rompe con v2 (desaparecen `video` y `focoOn/focoOff`, `assets.video` deja de existir,
`maxUpTime` pasa a ser obligatorio), pero ningún show v2 ha llegado a producción: el reproductor nuevo aún no se ha
activado. El hash dorado de `belen-2026.show.json` (`sha256:6e46887d…`) cambia en los tres repos.

### 2.1 Relé estandarizado

```json
"Sembra":  { "kind": "relay", "pin": 26 },
"Cartes":  { "kind": "relay", "pin": 24, "activeLow": false },
"Estable": { "kind": "relay", "expander": "exp1", "channel": 3 },
"exp1":    { "kind": "gpio_expander", "chip": "mcp23017", "bus": 1, "address": 32, "activeLow": true }
```

| Campo | Dónde | Regla |
|---|---|---|
| `pin` (GPIO BCM) | `Port.pin`, como hoy | Obligatorio **si no** hay `expander`; prohibido si lo hay. En el catálogo `relay.pin` pasa de `true` a `"optional"` |
| `expander` | `config`, `ref: gpio_expander` | Nombre de un puerto `gpio_expander` de la organización |
| `channel` | `config`, `int` 0–15 | Único por expansor (regla cruzada en `PortService`, igual que tira/segmento) |
| `activeLow` | `config`, `bool`, por defecto `false` | Solo para relés nativos; en el expansor se declara una vez para toda la placa |

Acciones: `turn_on(time?)`, `turn_off(time?)` como hoy y una nueva `pulse(duration)` (cierra `duration`
segundos y abre; sustituye el uso que se hacía de `focoOn` para pulsar botones). `focoOn` y `focoOff` desaparecen
del catálogo, del `RelayController` y de las acciones de tipo de pieza de Stocka (quien las tenga verá el error del
validador al exportar y las cambia por `turn_on`/`pulse`).

Puerto `gpio_expander` (infraestructura, sin tipo de pieza, sin acciones, `pin: false`): `chip` (enum,
hoy solo `mcp23017`), `bus` (`int`, por defecto 1), `address` (`int` 32–39, es decir 0x20–0x27, único por
organización), `activeLow` (`bool`). Aparece en `hardware` del show porque el reproductor necesita construirlo.
Reglas cruzadas: con cualquier expansor definido los GPIO 2 y 3 (I2C) pasan de aviso a **reservados**; borrar un
expansor con relés que lo usan se rechaza (409, como `PORTS_STRIP_IN_USE`).

### 2.2 Motor: `maxUpTime`

`motor.config.maxUpTime` (`number`, `min 0`, **obligatorio**): segundos máximos con el motor subiendo aunque el
sensor no detecte. `start_up(time)` con `time > maxUpTime` es un **error** de validación. El controlador corta por
`maxUpTime` siempre, además de por sensor y por el tiempo calculado actual.

### 2.3 Eliminación del vídeo

Desaparecen: `kinds.video`, `video` en `boards.rpi4b.capabilities`, `$defs/video` y `assets.video` en
`show.schema.json` (`assets` queda `{ "audio": [...] }`), `assets/video/` en `bundle.schema.json`,
`app/modules/video/`, `VideoController` en `core.py`, `storage.media_dir("video")`, `OutputKind.VIDEO`,
`ShowAssetRef`/`ShowBundleWriter`/`ShowPackageBuilder`/`ShowValidator` (rama vídeo), `types/catalog.ts` y
`types/show.ts` del editor, etiquetas `video` en el i18n del frontend. Migración `V25__drop_video.sql`: borra en
blando los puertos `kind = video` y pone a `NULL` el `kind` de los tipos de pieza `video` (sin ella la carga JPA
de un puerto con un `kind` que ya no existe en el enum fallaría).

### 2.4 Cabezal móvil: `kind: moving_head`

Perfil de aparato dentro del catálogo (`profiles.moving_head`), para que el backend, el editor y la Pi
compartan rangos y canales:

```json
"Foco": { "kind": "moving_head", "profile": "varytec-hero-wash-712z", "address": 1 }
```

| Campo | Regla |
|---|---|
| `profile` | `enum`; hoy solo `varytec-hero-wash-712z` (modo **15 canales** del aparato) |
| `address` | `int` 1–512; `address + canales − 1 ≤ 512`; los rangos de dos cabezales no se solapan (regla cruzada) |
| `universe` | no existe: un único adaptador USB = universo 1. Se añadirá cuando haga falta |

**Acciones** (controlador `DmxController`, direccionamiento por nombre):

| Acción | Parámetros | Semántica |
|---|---|---|
| `set` | `color?` (rgb), `white?` (int 0–255), `intensity?` (number 0–100 %), `pan?` (number 0–540 °), `tilt?` (number 0–190 °), `zoom?` (number 6–36 °), `time?` (duration, s) | Un **cue**: lleva los parámetros indicados desde el valor actual al nuevo en `time` segundos (interpolación lineal por fotograma DMX; `time` ausente = inmediato). Los no indicados no cambian |
| `blackout` | `time?` | `intensity` → 0 en `time` segundos sin mover el cabezal |

Unidades físicas (grados y porcentaje), no valores DMX: el perfil hace la conversión (pan/tilt a 16 bits con los
canales fino). Sin estroboscopio, macros de color, temperatura de color ni programas automáticos: esos canales se
emiten fijos a 0 y `shutter` abierto; la velocidad pan/tilt del aparato se fija a "rápida" y la interpolación la
hace la Pi, que es la que tiene el reloj del show.

**Posiciones con nombre** ("Estrella", "Portal", "Pastores"): se calibran con el modo prueba de la página de la Pi
(deslizadores de pan/tilt/zoom y lectura del valor) y se guardan en Stocka como **acciones del tipo de pieza
"Cabezal"** sobre la acción de catálogo `set` con `pan`/`tilt` como `staticValue` y `time` como `isDuration`. Así
el editor ofrece "Apuntar a la estrella (3 s)" sin que el contrato necesite un tipo nuevo de dato.

**Estado seguro:** `intensity` 0 y sin movimiento (no se recentra el cabezal en `SAFE` para no hacer ruido ni
desgastar). **Arranque:** el `DmxController` emite fotogramas desde que se construye (dimmer 0). **Cortes por
puerto (overrides):** un cabezal cortado emite dimmer 0 y congela pan/tilt/zoom, aplicado en el compositor del
fotograma como hace `GuardedStrip` con los píxeles. **`identify`:** blanco al 30 % tres segundos. **Adaptador
ausente o desconectado:** aviso en estado y en el latido, el resto del show sigue (ver decisión pendiente 6).

**Mapa de canales del perfil `varytec-hero-wash-712z`** (manual Varytec, modo 15 canales):

| Canal | Función | Uso del perfil |
|---|---|---|
| 1 / 2 | Pan grueso / fino (0–540°, centro 128) | `pan` → 16 bits |
| 3 / 4 | Tilt grueso / fino (0–190°, centro 128) | `tilt` → 16 bits |
| 5 | Velocidad pan/tilt (0 rápido … 255 lento) | fijo 0 |
| 6 | Dimmer (0 oscuro … 255) | `intensity` |
| 7 | Obturador (0–9 abierto, 10–250 estrobo 0–20 Hz, 251–255 abierto) | fijo 0 |
| 8 / 9 / 10 | Rojo / verde / azul (0–255, con canal 6 > 0) | `color` |
| 11 | Blanco (0–255) | `white` |
| 12 | Temperatura de color (0–100 %) | fijo 0 |
| 13 | Macros de color (0–10 sin función) | fijo 0 |
| 14 | Zoom (6° … 36°) | `zoom` |
| 15 | Programas automáticos / sonido / reset (231–240 ≥ 3 s) | fijo 0 |

Ajustes en el aparato (menú): `DMX Address` = 1, `DMX Channel` = `DMX 15 Ch`, `Running Mode` = `DMX`,
`Settings → Dmx Fail = OFF` (sin señal, se apaga; con `HOLD` quedaría encendido si la Pi muere). Conector XLR 3
pines, 80 W, 4,2 kg, montaje colgado o de pie.

**Varios cabezales a la vez.** El modelo es por puerto: cada cabezal es un puerto `moving_head` con su `address`
(1, 16, 31… en el menú de cada aparato), su pieza y su pista en el editor, así que dos clips sobre dos cabezales se
solapan en el tiempo como dos relés. El `DmxController` compone **un único fotograma** con el estado de todos los
cabezales y lo emite a 40 Hz por el mismo adaptador: dos movimientos que empiezan en el mismo `t` salen en el mismo
fotograma, alineados al milisegundo, y cada uno interpola su `time` por separado. Caben 34 cabezales de 15 canales en
un universo. Cableado: XLR en cadena (salida DMX del primero a la entrada del segundo) y terminador de 120 Ω en el
último si la tirada es larga. Cortes por puerto, `identify` y modo prueba son por cabezal.

Lo que **no** cubre el modelo y hay que decidir (§9, decisión 10): las posiciones calibradas viven en las acciones del
**tipo de pieza**, y dos cabezales montados en sitios distintos no apuntan a la "Estrella" con el mismo pan/tilt. Con
dos cabezales la solución inmediata es **un tipo de pieza por cabezal** ("Cabezal izquierdo", "Cabezal derecho"), cada
uno con sus posiciones. Si algún día hay más, se mueven las posiciones a la `config` del puerto (`positions`) y se
añade una acción `goto(position, time)` resuelta por puerto; eso exige un tipo nuevo de dato en el catálogo y no se
hace ahora. Tampoco hay grupos ("todos los cabezales a blanco cálido"): se copian los clips, igual que con los relés.

## 3. Cómo se añaden en los puertos de Stocka

Formulario de puerto (`PortFormDialog.vue`, campos por `kind` en `PortConfigFields.vue`):

- **Relé:** selector "Conexión": *GPIO de la Pi* (campo `pin`, validación de placa como hoy) o *Expansor* (desplegable
  con los puertos `gpio_expander` de la organización + `canal` 0–15, con los canales ya ocupados marcados). `activeLow`
  como casilla avanzada solo en GPIO. `PortRow` resume `GPIO 26` o `exp1 · canal 3`.
- **Expansor:** tipo de puerto nuevo, infraestructura (sin tipo de pieza, como las tiras): `chip`, `bus`, `address`
  (0x20–0x27 mostrado en hexadecimal), `activeLow`. No sale en el editor como pieza.
- **Cabezal móvil:** tipo de puerto `moving_head` con `profile` y `address`; requiere tipo de pieza de ese `kind`.
  El tipo de pieza "Cabezal" se crea en Stocka con sus acciones: `set` genérica (todo dinámico) y las posiciones con
  valores estáticos cuando se hayan calibrado.
- **Motor:** campo `maxUpTime` obligatorio junto a `downTime`.
- Desaparece el `kind` vídeo de los desplegables; las etiquetas i18n de `moving_head` y `gpio_expander` en ca/es/en.

El editor no cambia de modelo: una pieza "Foco" sobre el puerto `Foco`, una pista, clips con acciones del tipo de
pieza. Vista previa del cabezal: color medio del cue en el icono de la pieza (como las animaciones), sin simular
pan/tilt.

## 4. `rpi4-system`

- **Relés:** `RelayController` reescrito sobre una abstracción `RelayOutput` (`GpioRelay(pin, active_low)`,
  `ExpanderRelay(mcp, channel, active_low)`), construido **directamente desde `hardware` v3** (ya no pasa por
  `show_to_legacy`; la conversión a formato antiguo queda solo para tiras, motor, audio y pulsador). `turn_on`,
  `turn_off`, `pulse`; `stop`/`turn_off` masivos para `SAFE`.
- **Driver `app/drivers/mcp23017.py`** (`smbus2`): secuencia segura al arrancar — escribir `OLAT` con todo en
  reposo según `activeLow` **antes** de poner `IODIR` a salida, para que ningún relé parpadee; `FakeI2C` para
  `SIMULATE` y tests. `install.sh` activa I2C (`dtparam=i2c_arm=on`) si el show lo necesita.
- **Nivel de reposo de los GPIO nativos en el arranque:** los GPIO 4–8 arrancan con pull-up y entre el encendido y el
  servicio pasan 20–40 s. `tools/boot_gpio.py` genera las líneas `gpio=N=op,dl` de `/boot/firmware/config.txt`
  para los relés nativos del show activo; `install.sh --enable` las aplica (`op,dh` para `activeLow`).
- **Motor:** `AngelController` recibe `maxUpTime` y corta por él en `_process_up` sea cual sea el tiempo calculado.
- **DMX:** módulo `app/modules/dmx/`: `DmxUniverse` (512 bytes), hilo de refresco a 40 Hz, `DmxOutput` con tres
  implementaciones — `EnttecProOutput` (`pyserial`, protocolo del DMX USB Pro: `7E 06 len 00 … E7`, el adaptador
  retransmite solo), `OpenDmxOutput` (`pyftdi`, 250 kbaud 8N2, break ≥ 88 µs generado por la Pi) y `FakeDmxOutput`
  (simulación y tests, guarda el último fotograma). `Fixture` por perfil (`profiles/varytec_hero_wash_712z.py`)
  convierte el estado lógico (pan, tilt, zoom, color, white, intensity) a canales; `DmxController` guarda un estado
  por cabezal, interpola los cues y compone el fotograma aplicando cortes. Detección del adaptador por `/dev/serial/by-id/*`
  con reconexión.
- **Vídeo:** se borra `app/modules/video/`, `example_video.json`, ramas en `core.py`, `bundle.py`, `storage.py`,
  `bundle_tool.py`, `show_to_legacy.py`, fakes y tests.
- **Tests:** equivalencia actualizada (sin `Focos` como foco), relés nativos y por expansor con `FakeI2C`, secuencia
  de arranque sin parpadeo, `maxUpTime` con sensor desconectado, fotogramas DMX esperados por cue e interpolación,
  cortes sobre el cabezal, adaptador ausente, `identify`.
- `requirements.txt`: `smbus2`, `pyserial`, `pyftdi`.

## 5. Backend, editor y app

- **Backend:** `OutputKind` (+`MOVING_HEAD`, +`GPIO_EXPANDER`, −`VIDEO`); `PortConfigValidator` (`pin` xor
  `expander`, `ref: gpio_expander`, rangos); `PortService` (canal único por expansor, `address` único, solape de
  canales DMX, GPIO 2/3 reservados con expansor, 409 al borrar expansor en uso, renombrar expansor cascada a sus
  relés); `ShowValidator`/`ShowPackageBuilder`/`ShowHardware` con las mismas reglas; `ShowBundleWriter` sin vídeo;
  `V25__drop_video.sql`; herramientas MCP y recurso `stocka://catalog` al día; Bruno: relé por expansor, expansor,
  cabezal, motor sin `maxUpTime` rechazado.
- **Editor:** copia del catálogo v3 y esquemas, `showHardware.ts`/`showValidate.ts`/`showPackage.ts`, bundle sin
  `assets/video`, tipos, tests y hash dorado.
- **`belen-app`:** solo las etiquetas de `kind` si se muestran en los cortes por puerto; el modo prueba llegará
  después.

## 6. Modo prueba e `identify` (fase 5, adelantados)

Son las herramientas del banco y van antes que él: `/api/test/set` y `/api/test/release` (hoy 501), estado `TEST`
solo desde `IDLE`, PIN, cada orden caduca a los 60 s, el motor exige refresco cada 500 ms, `identify` tres
segundos; pestaña "Prova" en la página de la Pi con un control por puerto (interruptor, color, deslizadores
pan/tilt/zoom/intensidad con lectura numérica para copiar a Stocka). La app lo recibe después.

## 7. Banco (Joan, con la Pi por SSH)

Orden propuesto; cada punto con su criterio de aceptación.

1. **Audio por jack.** Volcar `config.txt`, `aplay -l`, `lsmod`, `asound.conf` de la Pi y guardarlos en
   `storage/scripts/audio-2025.md`. Reproducir un audio desde `belen.service` (root, sin escritorio) con las cuatro
   tiras animando a la vez: sin cortes ni ruido durante 5 minutos. Si fallara, el plan B es el adaptador USB.
2. **Relés nativos.** Estado en el encendido con las líneas `gpio=` aplicadas: ningún relé se activa entre el
   encendido y el servicio (10 encendidos). `identify` de cada relé para comprobar el cableado.
3. **Expansor.** `i2cdetect -y 1` ve la dirección; arranque sin parpadeo; 16 canales con `identify`; corte de
   puerto efectivo.
4. **Ángel.** Medir subida y bajada 5 veces; `downTime` y `maxUpTime` (1,3 × la subida más lenta) a Stocka. Con el
   sensor desconectado el motor para por `maxUpTime`.
5. **Cabezal.** Adaptador detectado; aparato en dirección 1, 15 canales, `Dmx Fail OFF`; cues de color, intensidad,
   pan/tilt y zoom con `time`; calibrar las posiciones con el modo prueba y crear las acciones estáticas del tipo
   de pieza; cortar el puerto apaga el cabezal; desenchufar el USB en mitad de un pase no para el resto del show.
6. **Pases.** 20 pases seguidos del show de 2026 sin desfase apreciable entre audio y luces.
7. **Arranque desatendido.** 10 encendidos en frío con página disponible en menos de 90 s; modo `ap` real desde
   un portátil ajeno (`http://10.42.0.1:8080`, cualquier URL abre la página); después `sudo storage/scripts/install.sh --enable`
   y etiqueta (`python -m tools.label --qr`).

## 8. Calendario propuesto

| Días | Trabajo | Quién |
|---|---|---|
| 21–22 oct | Contrato v3 (catálogo, esquemas, muestras, hash) y eliminación del vídeo en los tres repos | Claude |
| 23–24 oct | Relés estandarizados + expansor: driver, backend, formulario, editor | Claude |
| 27–29 oct | `DmxController`, perfil Varytec, salidas Enttec/Open DMX, cabezal en backend/frontend/editor | Claude |
| 30 oct | `maxUpTime` de punta a punta | Claude |
| 31 oct – 3 nov | Modo prueba + `identify` + pestaña Prova | Claude |
| 4–15 nov | Banco (§7) | Joan, con Claude por SSH |
| 16 nov | `install.sh --enable`, etiqueta, `git push` + `git pull` en la Pi, APK | Joan |
| 17–30 nov | Resto de fase 5 (evento `idle`, vista previa fiel) si hace falta | Claude |
| 6–8 dic | Montaje | |

El material (adaptador USB-DMX, placa de relés y MCP23017) tiene que estar en la mesa el 4 de noviembre.

## 9. Decisiones pendientes

| # | Decisión | Recomendación |
|---|---|---|
| 1 | **Adaptador USB→DMX** | Enttec DMX USB Pro o compatible con su protocolo (DMXking ultraDMX Micro): el adaptador retransmite el último fotograma por hardware, el enlace es serie normal y sobrevive a un tirón del proceso. Los Open DMX (FTDI pelado, 20–30 €) quedan soportados como segunda salida, pero la Pi tiene que generar el *break* desde espacio de usuario |
| 2 | **Placa de relés del expansor y recuento 2026** | Mantener los 10 relés nativos de 2025 tal cual y añadir un MCP23017 a 3,3 V con una placa de 16 canales con optoacopladores que acepte 3,3 V en la entrada lógica (alimentación de bobinas `JD-VCC` a 5 V separada). Un MCP23017 a 5 V no leería bien el I2C de 3,3 V de la Pi. Decidir cuántos relés nuevos hay |
| 3 | **Versión del contrato** | `stocka-show` v3 y catálogo v3 en un solo cambio, sin compatibilidad con v2: nadie tiene shows v2 activos |
| 4 | **Modelo de acciones del cabezal** | Una sola acción `set` (cue) + `blackout`, y las posiciones como acciones del tipo de pieza con valores estáticos. La alternativa (acciones `move`, `color`, `dimmer`, `zoom` separadas) multiplica los clips por cuatro |
| 5 | **Unidades** | Grados y porcentaje; el perfil convierte a DMX. Valores crudos 0–255 atan el show al aparato |
| 6 | **Adaptador DMX ausente en un pase** | Aviso (estado, pantalla, latido) y el show sigue; `ERROR` pararía luces y audio por un cable USB |
| 7 | **Estrobo, macros y programas del cabezal** | Fuera del catálogo; se añaden si algún día alguien los pide |
| 8 | **Cuántos cabezales** | El modelo admite varios por dirección; comprar uno y validar |
| 9 | **Fecha del banco y compra del material** | Semana del 4 de noviembre; antes no hay nada que probar que no esté ya probado en simulación |
| 10 | **Posiciones con dos cabezales** | Un tipo de pieza por cabezal con sus propias posiciones estáticas; `positions` en la config del puerto solo si algún día hay más de dos |

## 10. Riesgos

| Riesgo | Mitigación |
|---|---|
| El jack con las tiras en PWM 12/13 funcionó en 2025 pero el servicio nuevo corre como root sin sesión | Punto 1 del banco antes que nada; plan B adaptador USB con `asound.conf` |
| Nivel lógico 3,3 V insuficiente para la placa de relés | Elegir la placa por ese criterio (decisión 2); si no, etapa ULN2803 |
| Un `set` con `time` largo coincide con `SAFE` | `SAFE` cancela las interpolaciones y fija dimmer 0 en el mismo fotograma |
| El aparato con `Dmx Fail = HOLD` queda encendido si la Pi cae | Ajustar `OFF` en el menú; el banco lo comprueba desenchufando el USB |
| Posiciones calibradas que se pierden al cambiar de aparato o recolocarlo | Las posiciones viven en Stocka como acciones del tipo de pieza; recalibrar es editar dos números |

## 11. Estado de implementación (20 de octubre de 2026, noche)

Todo el software de esta fase está implementado y commiteado; lo que queda es el banco (§7) y las decisiones de compra (§9).

| Bloque | Repo · commit | Qué hay |
|---|---|---|
| Contrato v3 sin vídeo | `rpi4-system` 59d7e5e | Kind `video`, `VideoController`, `assets.video` y `assets/video/` fuera; `stocka-show` y catálogo v3 |
| Relés + expansor | `rpi4-system` 6e001de | `relay` con `pin` **o** `expander`+`channel`, `activeLow`, `pulse`; kind `gpio_expander`; `RelayController` desde `hardware`; driver `app/drivers/mcp23017.py` con arranque sin parpadeo; `tools/boot_gpio.py`; `install.sh` activa I2C |
| Cabezal DMX | `rpi4-system` 13c9a62 | Kind `moving_head`, perfil `varytec-hero-wash-712z` en el catálogo, `app/modules/dmx/` (Enttec Pro, Open DMX, simulado; un fotograma a 40 Hz con todos los cabezales), cortes y estado seguro, `status.dmx` |
| `maxUpTime` | `rpi4-system` 86edd2b | Obligatorio en el contrato, tope duro en `AngelController`, `E_MOTOR_UP_TIME` |
| Modo prueba e `identify` | `rpi4-system` 5734b4d | `PlayerCore.test_set/test_release/identify`, `GET /api/test`, `POST /api/test/{set,release,identify}`, panel «Prova» con deslizadores del cabezal |
| Backend | `backend` e82d331 | Catálogo v3, `PinMode`, `FixtureProfile`, reglas de puertos (expansor, I2C, DMX), `ShowValidator` igual que la Pi, show v3, migración V25, Bruno, test del ejemplo completo con el hash de la Pi |
| Editor | `timeline-editor` ccbefba | Catálogo y esquema v3, show v3 solo audio, `showValidate` con las reglas nuevas, fixtures y zips de interop regenerados |
| Frontend | `frontend` (commit de esta fase) | Formulario de puerto con «Connexió: GPIO / Expansor», campos por kind (`ref` genérico, enums), resumen por fila, i18n ca/es/en, mensajes de los códigos nuevos |

Suites: `rpi4-system` 537 tests · `backend` 1975 · `timeline-editor` 238. Hash dorado de `belen-2026`: `sha256:48a434c0…`; ejemplo completo `pessebre-2026-complet.show.json` (expansor, dos cabezales, ángel) validado con el mismo hash en la Pi, el backend y el editor.

**Pendiente (Joan, con el material delante):** decisiones 1, 2 y 9 de §9 (adaptador USB→DMX, placa de relés y recuento, semana del banco); el banco de §7 entero; `git push` de los cuatro repos y en la Pi `git checkout -- . && git pull --ff-only && venv/bin/pip install -r requirements.txt` (la Pi estaba apagada o sin hotspot el 20-10 por la noche y no se desplegó); comprobar la configuración de audio por jack en la Pi (punto 1 de §7); desplegar el backend (Flyway V25) y revisar en Stocka los tipos de pieza con acciones `focoOn`/`focoOff`, que ya no existen en el catálogo.

