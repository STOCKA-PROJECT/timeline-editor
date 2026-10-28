# Motores genéricos y sensores

**Plan del 21 de octubre de 2026.** Añade a la fase 4 ([`fase4-hardware-2026.md`](fase4-hardware-2026.md)) la
generalización del motor: hoy el kind `motor` es el ángel (tres pines, un sensor IR y una heurística de tiempo de
subida); queremos **varios motores bidireccionales**, con sus dos salidas por GPIO o por canal del expansor como los
relés, **sensores con nombre** que digan a un motor que deje de girar y un **sistema de paradas y alertas por
condición** que sirva para más cosas que el ángel. Nada de esto está implementado; se decide aquí y se implementa
después del cierre de la fase 4.

## 0. Qué hay y qué se quiere

| Hoy (`motor` = `AngelController`) | Lo que se quiere |
|---|---|
| Un solo motor; `pinR`, `pinL`, `sensorPin`, `downTime`, `maxUpTime` metidos en el motor | N motores; cada uno con dos salidas (A y B) por GPIO **o** por canal de un `gpio_expander`, como los relés |
| Acciones `start_up(time?)`, `start_down(time?)`, `stop()` con "arriba/abajo" cableados en el código | Acciones `forward(time)` («Girar»), `reverse(time)` («Girar (invertit)») y `stop()`; el tiempo de giro es la duración del clip |
| El sensor IR es un pin del motor; `get_gpio` invierte el nivel a mano (activo a nivel bajo fijo) | El sensor es un **puerto** (`sensor`) con nombre, polaridad, pull-up y antirrebote declarados; el motor lo referencia como **final de carrera** de una dirección |
| La subida termina por sensor o por un tiempo deducido de la bajada (+5 s) | El giro dura lo que dura el clip; termina antes si se activa el sensor de límite de ese sentido, y nunca pasa del tope duro `maxTime` del sentido |
| Si el sensor falla, nadie se entera | **Alerta** cuando una dirección con sensor acaba por tiempo (sensor roto o mecánica atascada), visible en la página, el estado y el latido; opcionalmente el motor queda bloqueado hasta que alguien lo revise |
| — | Un sensor también puede actuar sobre el show entero (`onActive`: parar el show o pánico), para una seta de emergencia o una puerta abierta |

## 1. El modelo en tres piezas

1. **`sensor`**: una entrada digital con nombre y un estado booleano **«activo»** (la polaridad se resuelve en la configuración, no en el código). Es infraestructura: no tiene tipo de pieza ni acciones. Es la única pieza nueva del contrato.
2. **`motor`**: dos salidas (sentido normal e invertido) que nunca se activan a la vez, con un tiempo muerto al invertir, un tope duro por sentido y, opcionalmente, un sensor de límite por sentido.
3. **Condiciones**: quién reacciona a que un sensor esté activo. De momento dos consumidores, con la misma sintaxis: el motor (límite de carrera de un sentido) y el show (`onActive` del propio sensor: nada, arrancar el pase, parar el show o pánico). Si mañana hay sensores analógicos o eventos del show disparados por sensores, se añaden como nuevos consumidores de la misma condición, no como otro modelo.

El pulsador de arranque **deja de ser un kind propio** (decisión 7): es un `sensor` con `onActive: play`. El kind `button` desaparece del contrato y la migración V26 convierte los puertos `button` existentes en sensores `onActive: play`.

## 2. Contrato (catálogo v3, sin cambiar de versión)

Nada v3 ha salido de los repos, así que el kind `motor` se **redefine** sin compatibilidad con la forma de ayer. El hash dorado de las muestras cambia otra vez; el ejemplo completo incorpora el ángel con la forma nueva y un segundo motor.

### 2.1 Kind `sensor` (nuevo, infraestructura)

```json
"AngelDalt": { "kind": "sensor", "pin": 22, "activeLow": true, "pull": "up", "debounceMs": 50 },
"Seta":      { "kind": "sensor", "pin": 23, "onActive": "panic" },
"PortaCaixa":{ "kind": "sensor", "expander": "exp1", "channel": 15, "onActive": "stop_show" }
```

| Clave | Tipo | Regla |
|---|---|---|
| `pin` **o** `expander` + `channel` | como el relé (`pin: "optional"`) | Entrada por GPIO (recomendado) o por canal del MCP23017 configurado como entrada |
| `activeLow` | bool, por defecto **true** | Contacto a masa con pull-up, que es como está cableado el IR del ángel. `false` para sensores que dan nivel alto |
| `pull` | enum `up` / `down` / `none`, por defecto `up` | Resistencia interna del GPIO; en el expansor solo `up` (GPPU) o `none` |
| `debounceMs` | int 0–2000, por defecto 50 | El cambio solo cuenta si se mantiene ese tiempo |
| `onActive` | enum `none` / `play` / `stop_show` / `panic`, por defecto `none` | Qué hace el reproductor con el show cuando el sensor pasa a activo, además de lo que hagan los motores que lo usen. `play` arranca un pase si está en reposo (lo que hoy hace el pulsador; en modo `pulse`, los ciclos del show); `stop_show` para el pase en curso y deja las salidas en seguro; `panic` pone todo en seguro y deja el reproductor en `SAFE` hasta que alguien lo reactive |

Sin acciones: no es un objetivo del timeline. Aparece en `hardware` porque el reproductor lo necesita y en los cortes por puerto (un sensor cortado se considera **nunca activo**, salvo que sea `onActive: panic`, que no se puede cortar). Un sensor `play` solo arranca el show, al soltarlo: el pulsador está al alcance del público, así que desde el 26-10 no tiene pulsaciones largas (antes 10 s forzaban la Wi-Fi propia y 30 s lo ponían todo en seguro).

### 2.2 Kind `motor` (redefinido)

```json
"Angel": {
  "kind": "motor",
  "pinForward": 27, "pinReverse": 17,
  "switchDelayMs": 50,
  "maxTimeForward": 24, "limitForward": "AngelDalt",
  "maxTimeReverse": 18,
  "lockOnTimeout": true
},
"Noria": { "kind": "motor", "expander": "exp1", "channelForward": 6, "channelReverse": 7, "maxTimeForward": 60, "maxTimeReverse": 60 }
```

| Clave | Tipo | Regla |
|---|---|---|
| `pinForward`, `pinReverse` **o** `expander` + `channelForward` + `channelReverse` | ints / ref + ints | Las dos salidas en GPIO o las dos en el **mismo** expansor (una placa de relés o un puente H), nunca mezcladas. Canales distintos. Un canal lo usa un solo puerto, sea relé o motor |
| `activeLow` | bool, por defecto false | Solo nativos; en el expansor manda la placa |
| `switchDelayMs` | int 0–5000, por defecto 50 | Tiempo muerto con las dos salidas apagadas al invertir el sentido. Los motores van con puente H (IN1/IN2 = salida normal / invertida); un motor con relés mecánicos debería subirlo a 300 ms o más |
| `maxTimeForward`, `maxTimeReverse` | number > 0, **obligatorios** | Tope duro por sentido: el motor nunca gira más de ese tiempo seguido en ese sentido, pase lo que pase |
| `limitForward`, `limitReverse` | ref `sensor`, opcionales | Final de carrera: al activarse el sensor mientras gira en ese sentido, el motor para. Si ya está activo al pedir el giro, no arranca |
| `lockOnTimeout` | bool, por defecto false | Si un sentido **con** sensor acaba por `maxTime`, además de la alerta el motor queda bloqueado (no acepta giros) hasta que se libere desde la página o la app |

Acciones (nombres visibles por defecto en ca/es/en; en Stocka cada tipo de pieza puede renombrarlas):

| Acción | Nombre visible | Parámetros | Semántica |
|---|---|---|---|
| `forward` | «Girar» | `time` (duration, s) | Gira en sentido normal **la duración del clip**; para antes si se activa `limitForward`; nunca más de `maxTimeForward`. Si giraba al revés, para, espera `switchDelayMs` y arranca. Si ya giraba en ese sentido, cuenta el tiempo de nuevo desde ahora |
| `reverse` | «Girar (invertit)» | `time` (duration, s) | Igual en sentido invertido, con `limitReverse` y `maxTimeReverse` |
| `stop` | «Aturar» | — | Para (las dos salidas apagadas) |

`time` es el parámetro de duración: en el editor lo rellena la longitud del clip, como el `time` de los relés. En el
contrato es opcional para quien escriba un show a mano: sin `time`, el giro dura hasta el sensor o `maxTime`. Un clip
más largo que `maxTime` de su sentido es error del validador (hoy `E_MOTOR_UP_TIME`, pasa a `E_MOTOR_TIME`).

Qué sentido es «normal» lo decide el cableado: si el ángel sube con la salida que se ha llamado `Forward`, en Stocka
el tipo de pieza «Àngel» puede renombrar sus acciones a «Pujar» y «Baixar»; un motor de noria se queda con «Girar» y
«Girar (invertit)». El ángel queda como hoy: «Girar» con un clip de, por ejemplo, 30 s sube hasta `AngelDalt` y como
mucho 24 s; «Girar (invertit)» con un clip de 18 s baja 18 s.

### 2.3 Validación (las mismas reglas en `validate.py`, backend y editor)

| Código | Nivel | Regla |
|---|---|---|
| `E_MOTOR_OUTPUTS` | error | Salidas incoherentes: pines y expansor mezclados, falta una salida, `channelA = channelB`, `activeLow` con expansor |
| `E_SENSOR_MISSING` | error | `limitForward`/`limitReverse` no es un puerto `sensor` |
| `E_MOTOR_TIME` | error | `forward`/`reverse` con `time` (la duración del clip) mayor que el `maxTime` de su sentido, salvo que ese sentido tenga sensor de límite (entonces es aviso `W_MOTOR_TIME_CAPPED`: el clip puede ser largo porque para el sensor, pero nunca girará más de `maxTime`) |
| `E_PIN_DUPLICATE`, `E_EXPANDER_CHANNEL_DUPLICATE` | error | Los pines y canales de motores y sensores cuentan como los de relés (entrada o salida, un pin es de un solo puerto) |
| `E_PIN_RESERVED` | error | GPIO 2/3 con expansor, también para sensores |
| `E_MOTOR_OUTPUTS` también | error | `limitForward`/`limitReverse` apuntando al mismo sensor está permitido; apuntando a un puerto que no es `sensor`, no (`E_SENSOR_MISSING`) |
| `W_SENSOR_UNUSED` | aviso | Sensor sin `onActive` que ningún motor referencia |

Reglas cruzadas en el backend (`PortService`): borrar un sensor que un motor usa de límite → 409 `ports.sensor_in_use`; renombrarlo actualiza `limitForward/limitReverse` de los motores; un motor por expansor consume dos canales en el mismo conjunto que los relés.

## 3. Reproductor (`rpi4-system`)

- **Entradas** (`app/modules/inputs/inputController.py`, nuevo): lee los sensores (GPIO y canales de entrada de los expansores) en un hilo cada 20 ms, aplica el antirrebote y mantiene `active[nombre]`. Expone `is_active(name)`, `snapshot()` para el estado y `on_change(callback)`. Lee el **nivel crudo** con una función nueva `gpios.read_level(pin)` (la actual `get_gpio` invierte el nivel a mano y se queda solo para el core antiguo) y configura el GPIO con el `pull` del sensor. El driver `Mcp23017` gana dirección por canal (bits de `IODIR`), pull-up (`GPPU`) y `read_channel`, con las salidas intactas.
- **Motores** (`app/modules/motors/motorController.py`, nuevo, sustituye a `AngelController` en el core nuevo): N motores construidos desde `hardware`, salidas `GpioRelay`/`ExpanderRelay` reutilizadas del `RelayController`. `forward(name, time=None)` y `reverse(name, time=None)` lanzan una tarea por motor que enciende la salida, vigila el tiempo del clip, el límite y `maxTime`, y apaga; la inversión pasa por `switchDelayMs` con todo apagado; la clase garantiza que las dos salidas nunca estén activas a la vez (en un puente H, IN1 e IN2 altos a la vez frenan o cortocircuitan según el modelo; el reproductor nunca lo hace) y que `stop` deje las dos a nivel bajo (motor libre). `stop(name=None)`, `is_process_running(name=None)`, `_set_blocked(names)`, `status()` (dirección, segundos girando, último fin: `time` / `limit` / `max_time` / `stop`). Un giro que acaba por `maxTime` en un sentido con sensor emite una **alerta** (y bloquea el motor si `lockOnTimeout`). `AngelController` queda solo para `main.py --legacy`.
- **Core**: `status.sensors` (estado en vivo), `status.alerts` (lista con código, puerto, mensaje y hora; en memoria desde el arranque), `onActive` de los sensores conectado a `stop()`/`panic()`, `_safe_outputs` para motores, overrides (sensor cortado = nunca activo; motor cortado = salidas a cero, como los relés), latido con `alerts`. API: `GET /api/alerts`, `DELETE /api/alerts` (y `POST /api/motors/{name}/unlock` para `lockOnTimeout`). Modo prueba: motor `{"direction": "forward" | "reverse" | "stop"}` (refresco cada 0,5 s, como hoy) y, en el panel «Prova», un indicador en vivo por sensor: es la herramienta para comprobar el cableado del IR y de las setas sin mover nada.
- **Herramientas**: `tools/boot_gpio.py` añade `pinForward`/`pinReverse` (`op,dl` / `op,dh` según `activeLow`); `show_to_legacy` deja de convertir motores (ya no hay forma antigua: `ConversionError` en modo estricto, omitidos en el cargador).
- **Tests**: `InputController` con GPIO y expansor simulados (polaridad, pull, antirrebote, `onActive`), `MotorController` (fin por `time`/límite/`maxTime`, inversión con tiempo muerto, exclusión A/B, bloqueo, alerta, `lockOnTimeout`, cortes), reglas nuevas del validador, muestra completa con dos motores y tres sensores (uno de pánico), core (alertas en status y latido, test mode), API.

## 4. Backend, editor, frontend y app

- **Backend**: `OutputKind.SENSOR`; `PortConfigValidator` (salidas del motor coherentes, sensor coherente); `PortService` (pines de sensores y motores en los conflictos de pin, canales de motores en los conflictos de canal, refs `limitForward/limitReverse`, `sensor_in_use`, renombrado en cascada); `ShowValidator` con las reglas de §2.3; códigos `ports.motor_outputs_invalid`, `ports.sensor_not_found`, `ports.sensor_in_use`; migración **V26** que convierte los puertos `motor` antiguos que aún existan (`pinL`→`pinForward`, `pinR`→`pinReverse`, `maxUpTime`→`maxTimeForward`, `downTime`→`maxTimeReverse`, y crea un puerto `sensor` «`<motor>-límit`» con `sensorPin` como `limitForward`) convierte los puertos `button` en `sensor` con `onActive: play` (mismo nombre y pin) y renombra las acciones de los tipos de pieza de kind `motor`: `start_up`→`forward`, `start_down`→`reverse` (conservando su nombre visible y sus parámetros, porque `time` sigue siendo la duración). Se ensaya sobre la copia local de la base de datos de producción antes de desplegar. Bruno: sensor, motor nativo, motor por expansor, rechazos. Herramientas MCP al día.
- **Editor**: catálogo y reglas; la vista previa del motor sigue siendo un marcador (sin simular el giro).
- **Frontend**: formulario de puerto `motor` con el mismo selector «Connexió» que el relé y dos canales; formulario `sensor` (polaridad, pull, antirrebote, `onActive`); los `ref` a sensores salen del `PortConfigFields` genérico; resumen por fila (`⟳ GPIO 27 · ⟲ GPIO 17 · ⟳ límit AngelDalt, màx 24 s · ⟲ màx 18 s`); i18n ca/es/en; mensajes de los códigos nuevos.
- **App móvil**: muestra `status.alerts` y los sensores en vivo en la pestaña Pessebre; botón para limpiar alertas y desbloquear un motor.

## 5. Banco (se añade al §7 de la fase 4)

1. Cada sensor en el panel «Prova»: activo/inactivo al tapar el IR o pulsar la seta; polaridad correcta.
2. Ángel: «Girar» para en el sensor; con el sensor desconectado para a `maxTimeForward` y aparece la alerta; «Girar (invertit)» gira la duración del clip; inversión en marcha respeta `switchDelayMs` (con un LED o el osciloscopio en IN1/IN2: nunca altos a la vez).
3. Segundo motor por expansor: mismas comprobaciones; los dos canales nunca a la vez (medir con el multímetro).
4. Seta de emergencia (`onActive: panic`): todo a seguro en menos de 100 ms y estado `SAFE`.
5. Medir las subidas y bajadas reales y fijar `maxTimeForward/Reverse` a 1,3 veces la más lenta.

## 6. Bloques y calendario

| Bloque | Qué | Estimación |
|---|---|---|
| 1 | Contrato (catálogo, esquema, `validate.py`, muestras) + reproductor (entradas, motores, alertas, API, panel, tests) | 1,5 días |
| 2 | Backend (kinds, reglas, V26, Bruno, tests) | 0,5 días |
| 3 | Editor + frontend + app | 0,5 días |

Encaja antes del banco: contrato y reproductor el 22–23 de octubre, backend y clientes el 24; el banco del 4 de noviembre ya lo probaría todo junto. Un commit por bloque, como hasta ahora.

## 7. Decisiones

Se van preguntando en el chat a medida que hacen falta; aquí queda lo que se decida.

| # | Decisión | Estado |
|---|---|---|
| 1 | El tiempo de giro es la duración del clip (`time` como parámetro de duración) | **Decidido** (Joan, 21-10) |
| 2 | Dos acciones `forward` («Girar») y `reverse` («Girar (invertit)») en vez de una con dirección | **Decidido** (Joan, 21-10) |
| 3 | Salidas todo/nada, sin velocidad PWM este año | **Decidido** (Joan, 21-10): sin control de velocidad |
| 4 | Sensores también por canal del expansor | **Decidido** (Joan, 21-10): sí, pin o expansor + canal; seta y final de carrera del ángel por GPIO como recomendación de cableado |
| 5 | Polaridad por defecto del sensor: activo a nivel bajo con pull-up | **Decidido** (Joan, 21-10): sí (`activeLow: true`, `pull: up`) |
| 6 | Tiempo agotado con sensor: alerta, y bloqueo opcional por motor | **Decidido** (Joan, 21-10): el motor para y aparece la alerta siempre; con `lockOnTimeout` el motor deja de funcionar hasta desbloquearlo desde la página o la app |
| 7 | `onActive` del sensor sobre el show | **Decidido** (Joan, 21-10): sí, con `none`, `play`, `stop_show` y `panic`; el pulsador pasa a ser un sensor `onActive: play` y el kind `button` desaparece |
| 7b | Pulsación larga de un sensor `play` (hoy 10 s Wi-Fi propia, 30 s pánico) | ~~Decidido (Joan, 21-10): todos los sensores `play` la tienen~~ · **Revisado** (Joan, 26-10): se quita; el pulsador es del público y solo arranca el show |
| 8 | (Absorbida por la 7) | — |
| 9 | Seguimos en contrato v3 aunque cambie el hash dorado | **Decidido** (Joan, 21-10): sí, v3; el hash dorado se actualiza en los tres repos en el mismo cambio |
| 10 | Migración V26 de motores, pulsadores y acciones | **Decidido** (Joan, 21-10): sí, conversión automática de puertos `motor` (con su sensor «`<motor>-límit`»), puertos `button` (a `sensor` `onActive: play`) y acciones `start_up`/`start_down`; se ensaya sobre la copia local de producción antes de desplegar |
| 11 | Tiempo muerto al invertir | **Decidido** (Joan, 21-10): los motores van con puente H; `switchDelayMs` por defecto **50 ms**, configurable por motor (300 ms o más si algún motor va con relés) |

## 7b. Estado de implementación (21-10-2026)

Implementado y commiteado en los cinco repos; nada subido a GitHub ni desplegado.

| Repo | Commit | Contenido | Pruebas |
|---|---|---|---|
| `rpi4-system` | ef17caf | Catálogo, esquema y `validate.py`; `InputController`, `MotorController` (puente H, tiempo muerto, finales de carrera, `maxTime`, bloqueo), alertas, `/api/alerts`, desbloqueo, página local, latido con alertas, `show_to_legacy` | 602 |
| `backend` | 3b22da1 | Validador de puertos y `PortService` (pin o expansor común, finales de carrera, sensor en uso, canales compartidos), `ShowValidator`, alertas del latido (`last_alerts`), V26 ensayada sobre la copia de producción, Bruno, guía MCP | 2021 |
| `timeline-editor` | 7d49de6 | Catálogo, `showValidate` con las mismas reglas, muestras y hash dorado `88db057d` (verificado con `tools.bundle_tool inspect`) | 243 |
| `frontend` | bcdfa03 | Formulario de motor y sensor, resúmenes, alertas en Dispositius, i18n ca/es/en | `pnpm build` |
| `belen-app` | 9654d1b | Alertas, sensores en vivo, estado y desbloqueo de motores | 92 |

Cambio respecto al plan: el aviso `W_LEGACY_SINGLE` ya no cuenta motores (el reproductor nuevo
gobierna varios); solo queda para `audio`.

Pendiente: banco (§5), push de los cinco repos, despliegue en la Pi y despliegue del backend
(Flyway V24, V25 y V26).

## 8. Fuera de alcance (y cómo encajaría)

- **Velocidad** (PWM): kind aparte o parámetro `speed` del `run` solo para motores con salida PWM.
- **Sensores analógicos** (distancia, luz, ADC por I2C): el mismo `sensor` con `type: analog` y condiciones `when: above/below`; `limitForward` admitiría `{ sensor, when }`.
- **Eventos del show disparados por sensores** (por ejemplo, que el público active algo): un consumidor más de la condición, en el timeline como `trigger`; no antes de tener el `idle` de la fase 5.
- **Interrupciones del MCP23017** (INTA/INTB a un GPIO) si el sondeo a 20 ms resultara insuficiente.
