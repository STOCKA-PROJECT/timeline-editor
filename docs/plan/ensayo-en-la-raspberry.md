# Ensayo en la Raspberry · plan

> 23 de octubre de 2026. Sustituye al «modo monitor» de `original/05-simulador-vista-previa.md` §6 para el caso que importa:
> editar un trozo del timeline y verlo enseguida en el belén real, sin esperar desde el segundo 0 ni enviar, activar y
> reproducir a mano cada vez.

**Estado (23 de octubre): implementado en local, sin desplegar.** `rpi4-system` 4266dae + fd2085c (893 tests),
`timeline-editor` (472 tests) y `belen-app` (109 tests). Probado contra una Pi simulada (`main.py --simulate`): falta de
audio (409), subida suelta, tramo en bucle a 4 mensajes por segundo, motor cortado saltado y salida. Sin probar en el
navegador ni con hardware. Diferencias con lo planteado: el registro de la Pi dice el instante del show (`showT`) y el
tramo se marca en la regla del timeline.

**Cambio del 23 de octubre (tarde):** a petición de Joan la barra de transporte queda en una sola fila con solo
«Inici» y «Fi» (en `m:ss`; «Fi» vacío = hasta el final del último clip) y desaparecen «Fin» y «Puntero». La duración
del show ya no se escribe: es siempre el final de su último clip, en el editor (`scene.durationMs` calculada) y en el
backend (`SceneDocument` la deriva; se elimina la operación `set_duration`).

## 1. Objetivo

Joan edita una animación de LEDs en el minuto 5:15. Hoy, para verla en el belén, tiene que enviar el show, activarlo y
esperar más de cinco minutos. Con el ensayo:

1. Pone la marca **Inicio** en 5:10 y, si quiere, la marca **Hasta** en 5:40, con **Repetir** activado (la marca de
   inicio y el bucle ya existen en el editor).
2. Pulsa **«Prova a la Raspberry»** en los controles del timeline. La Pi empieza en 5:10 con todo como estaría en ese
   momento y repite el tramo; el cabezal del editor sigue a la Pi.
3. Cambia el clip y vuelve a pulsar el botón (ahora **«Torna a provar»**): en un par de segundos la Pi reproduce de nuevo
   el tramo con el cambio. Solo viaja el JSON del show; los audios que la Pi ya tiene no se vuelven a enviar.
4. Al acabar, **«Surt de l'assaig»**: la Pi vuelve a su show activo, intacto.

Decisiones de Joan (23 de octubre):

| Pregunta | Decisión |
|---|---|
| Cuándo se vuelve a probar | Con un **botón en el timeline**, no automáticamente al editar |
| Desde dónde | **Marca de inicio + bucle** |
| Motores | Un motor solo se mueve si, dentro del tramo, sus clips «Girar» y «Girar (invertit)» están **enteros** (ninguno cortado por el inicio o el final del tramo) y hay **el mismo número de cada uno**; si no, ese motor no se mueve en el ensayo |
| Dónde vive el show de ensayo | **Temporal**: no entra en el historial ni sustituye al show activo; al salir del ensayo (o si la Pi se reinicia) vuelve el show activo |

Fuera de alcance: la vista previa fiel del editor (descartada el 23 de octubre), el envío automático al editar y la
publicación desde la nube (descartada).

## 2. Raspberry (`rpi4-system`)

### 2.1 API

| Método | Ruta | PIN | Qué hace |
|---|---|---|---|
| POST | `/api/rehearsal` | Sí | Cuerpo `{show, fromMs, toMs?, loop}`. Valida el paquete con el mismo validador que la importación (422 con el informe si tiene errores), comprueba que tiene los audios (409 `missing_assets` con la lista si no), lo carga **en memoria** y empieza en `fromMs`. Si ya había un ensayo, lo sustituye y vuelve a empezar. |
| DELETE | `/api/rehearsal` | Sí | Para, deja las salidas en seguro y vuelve a cargar el show activo. |
| PUT | `/api/assets/audio/{name}` | Sí | Sube un audio suelto (mismas reglas de nombre y tamaño que el paquete) para que el ensayo pueda usar un audio nuevo sin importar un paquete. |

- `status` gana `rehearsal: {fromMs, toMs, loop, startedAt, skippedMotors: [{target, reason}]} | null`, y mientras hay
  ensayo `cycleMs` cuenta desde 0 del show (no desde `fromMs`), para que el editor ponga el cabezal tal cual.
- Mientras hay ensayo, `/api/events` envía el estado cada 250 ms (hoy solo con cambios y cada 5 s), para que el cabezal
  no vaya a saltos.
- `play`, `activate`, importar con `activate`, el modo prueba y el pulsador `onActive: play` responden `409 rehearsal`
  mientras dura el ensayo. `stop` para el tramo pero sigue en ensayo; `panic` sale del ensayo.
- Si en 15 minutos no llega ningún `POST /api/rehearsal`, el ensayo se cierra solo (el portátil se fue).

### 2.2 Empezar a mitad: «ponerse al día»

Función pura nueva `app/core/catch_up.py`: `catch_up(events, from_ms, to_ms) -> (inmediatos, programados, saltados)`.
Para cada `target`, mira los eventos con `t < fromMs` y calcula qué hay que aplicar en el instante `fromMs`:

| Tipo | Regla |
|---|---|
| Relé `turn_on` / `turn_off` sin `time` | Se aplica el último. |
| Relé con `time` | Si aún no ha acabado (`t + time > fromMs`), se aplica con el tiempo que queda; si ya acabó, se aplica el estado en que queda. |
| Relé `double_pulse` | Si cae antes del inicio, no se repite. |
| LED `fill` / `clear` / `setBrightness` | Se aplica el último. |
| LED `animate` con `duration` | Si aún no ha acabado, empieza con la duración que queda y con un parámetro nuevo `offset` (segundos ya transcurridos). `fade`, `sunrise` y `sunset` lo usan para empezar por el color que tocaría; las de bucle (`stars`, `fire`…) solo necesitan la duración restante. Si ya acabó, queda como la dejó la animación (`fade` y familia: su color final). |
| LED `animate` sin `duration` | Si es la última del target, empieza (es continua). |
| Audio `play` | Si no hay un `stop` después, empieza con `start` + (fromMs − t) y, si tenía `time`, con el tiempo que queda; VLC ya sabe saltar (`set_time`). Si el salto pasa del final, no suena. |
| Cabezal `set` / `blackout` | Se combinan todos los campos fijados antes del inicio y se aplica el resultado; si la última transición sigue en marcha, con el tiempo que le queda. |
| Motor | Nunca se pone al día (véase 2.3). |

Los eventos con `fromMs ≤ t < toMs` se programan como siempre, restando `fromMs`. Al llegar a `toMs` el tramo acaba,
todo pasa a seguro y, con `loop`, se vuelve a poner al día y empieza otra vez.

### 2.3 Regla de los motores

Por cada motor, dentro de `[fromMs, toMs)`:

- algún clip `forward` o `reverse` cortado por el inicio o el final del tramo → **no se mueve** (`reason: "cut"`);
- número de `forward` ≠ número de `reverse` → **no se mueve** (`reason: "unbalanced"`, con los dos números);
- si no, sus eventos (incluidos `stop`) se ejecutan con normalidad.

Los eventos de motor anteriores al inicio nunca se ejecutan. Los finales de carrera y `maxTime*` siguen funcionando
igual. La lista de motores saltados va en `status.rehearsal.skippedMotors` y la respuesta del `POST`.

### 2.4 Cargar sin almacenar

`loader.load_from_package(pkg, media_dir, catalog)`, junto a `load_from_storage`, carga un paquete validado sin
escribirlo en `storage/shows`. `PlayerCore` guarda el show activo para volver a él (`end_rehearsal` → `load_show(active)`).

### 2.5 Tests

`test_catch_up.py` (cada fila de la tabla 2.2, más el límite exacto `t + time == fromMs`), regla de motores (cortado
al inicio, cortado al final, desequilibrado, equilibrado, sin clips), core (sustituir un ensayo, `stop`, `panic`, cierre
a los 15 min, 409 de las demás órdenes), API (PIN, 422, 409 `missing_assets`, `PUT` de audio) y `offset` en
`fade`, `sunrise` y `sunset`.

## 3. Editor (`timeline-editor`)

- **Marca «Fi»** en `PlaybackControls`, junto a «Inici»: `playback.rangeEndMs` (vacía = el final del último clip). La vista previa
  local también la respeta en bucle. No confundir con «Fin», que es la duración de la escena.
- **Botón «Prova a la Raspberry»** en los mismos controles. Sin una Pi conectada abre «Dispositius». Al pulsarlo:
  construye el paquete de la escena tal como está (no hace falta guardar antes), sube los audios que falten con
  `PUT /api/assets/audio/{name}` y llama a `POST /api/rehearsal` con Inici, Fi y Repetir. Si el show tiene errores, no
  envía nada y los enseña.
- Con el ensayo en marcha, el botón pasa a **«Torna a provar»** (atajo Ctrl+Enter) y aparece **«Surt de l'assaig»**. El
  cabezal sigue el `cycleMs` de la Pi (interpolado entre mensajes), la vista previa local queda en silencio y una línea
  dice «Assaig a «Pessebre» · 5:10 → 5:40 · en bucle», más los motores saltados con su motivo.
- `PiClient`: `rehearse()`, `endRehearsal()`, `putAudio()`; tipos `PiRehearsal`. Tests de cliente y del cálculo de
  audios que faltan.

## 4. Página de la Pi y app (`belen-app`)

Solo informativo: una fila «En assaig des de l'editor (5:10 → 5:40)» y un botón «Surt de l'assaig». Sin crear ensayos.

## 5. Orden y despliegue

1. Pi: `catch_up` + tests, regla de motores, `load_from_package`, API, `offset` en las animaciones.
2. Editor: marca «Fi», cliente, botón y seguimiento del cabezal.
3. Página de la Pi y app.

No cambia el contrato del paquete ni el hash, ni el backend. Desplegar primero la Pi (un editor nuevo con una Pi vieja
recibe 404 en `/api/rehearsal` y lo dice: «Actualitza la Raspberry»). Sin hardware conectado se puede probar todo con
`--simulate` y los registros; ver las luces de verdad tendrá que esperar al banco.
