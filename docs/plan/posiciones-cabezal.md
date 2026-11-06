# Posiciones con nombre por cabezal

**6 de noviembre de 2026.** Resuelve la decisión 10 de `fase4-hardware-2026.md`: las posiciones del cabezal
(pan, tilt, zoom, intensidad, color) dejan de vivir en las acciones del tipo de pieza y pasan a la
configuración de **cada puerto** `moving_head`. Un solo tipo de pieza "Cabezal" sirve para todos los
cabezales; cada puerto es un aparato con sus propias posiciones ("Portal", "Estrella") calibradas desde la
página del dispositivo, y los clips del timeline las eligen por nombre.

## 1. Decisión de Joan

> Todos los cabezales son un tipo, luego ya cada puerto es un cabezal pero son del mismo tipo.

Consecuencias:

- Dos cabezales montados en sitios distintos tienen un "Portal" cada uno con pan/tilt distintos. Un clip
  "Portal" sobre la pieza que tiene los dos puertos manda a cada cabezal a su propio Portal.
- Las posiciones se calibran moviendo el cabezal con deslizadores desde la página del dispositivo (modo
  prueba de la Pi) y se guardan con nombre en el puerto de Stocka, sin teclear números.
- No hay tipo de pieza por cabezal ni acciones con pan/tilt fijos (siguen funcionando, pero ya no hacen falta).

## 2. Contrato (catálogo v3, cambio aditivo)

`rpi4-system/contract/catalog.json`, copiado byte a byte al backend y al editor:

- `kinds.moving_head.config.positions`: tipo nuevo **`positions`**, lista de
  `{ name, pan?, tilt?, zoom?, intensity?, color?, white? }` en las mismas unidades que `set` (grados,
  porcentaje, RGB 0–255). Nombre obligatorio y único por puerto (sin distinguir mayúsculas); al menos un
  valor; cada valor dentro del rango del perfil del puerto.
- `kinds.moving_head.actions.set.params.position`: tipo nuevo **`position`**, el nombre de una posición del
  puerto. Sus valores rellenan los parámetros que el cue no indica; **los indicados mandan** ("Portal, pero
  al 50 %").
- `kinds.moving_head.actions.set.params.from_position` (también `position`): **animación de una posición a
  otra en un solo clip**. El cabezal salta a la posición de partida y en `time` segundos (la duración del clip)
  llega a `position` o a los valores del cue. La exportación lo escribe como un `set` inmediato a la partida
  justo antes del `set` con `time` (mismo `t`, orden estable, el reproductor los ejecuta en orden). Sin
  `from_position`, el movimiento sale de donde esté el cabezal (clips consecutivos "Portal" → "Estrella" ya
  son una animación).

El `stocka-show` no cambia de formato: `hardware.<cabezal>.positions` viaja con el resto de la config del
puerto (`show.schema.json` lo admite), y la exportación **resuelve `position` por puerto** antes de escribir
el evento, de modo que `timeline[].params` siempre lleva valores concretos. Un reproductor que reciba
`position` sin resolver también lo resuelve con las posiciones de su `hardware`.

## 3. Reproductor (`rpi4-system`)

- `DmxController`: cada `Head` guarda sus `positions`; `set(..., position=None, from_position=None)` aplica la
  posición (los parámetros explícitos la sobrescriben) y, con `from_position`, parte de esa posición; una
  posición desconocida se registra y se ignora.
- `contract/validate.py`: `check_value` conoce `position` (texto no vacío) y `positions` (lista de objetos
  con `name`).
- Modo prueba: `position` se admite en `params` de un cabezal (`{"position": "Portal"}`).

## 4. Backend

- `CatalogType`: `POSITION` (acepta `TEXT`) y `POSITIONS` (solo config).
- `PortConfigValidator`: valida `positions` contra el perfil del puerto → 400 `ports.position_invalid` con
  `params.reason` (`not_list`, `not_object`, `name_required`, `name_duplicate`, `empty`, `unknown_key`,
  `<campo>_invalid`, `<campo>_out_of_range` con `min`/`max`) e `index`/`name`.
- `SceneContext.PortRef` lleva los nombres de las posiciones; `SceneValidator` emite
  **`E_POSITION_UNKNOWN`** cuando el clip nombra una posición que algún puerto que mueve no tiene.
- `ShowPackageBuilder`: resuelve `position` por puerto (misma regla que el editor), con
  `E_POSITION_UNKNOWN` si el puerto no la tiene.
- MCP: pistas de `port_create`/`port_update`, recurso catálogo (automático). Bruno: alta de cabezal con
  posiciones y cambio de posiciones.

## 5. Editor

- `showPackage.ts`: resuelve `position` por puerto antes de validar los parámetros (espejo del Java).
- `ClipInspector` + `ActionParameterInput`: un parámetro de tipo `position` se elige en un desplegable con
  las posiciones de los puertos que el clip mueve (el de la pista, o la intersección de los que hacen del
  tipo de la acción); un valor que ya no existe se conserva marcado.
- `showCoerce`/`showValidate`: los dos tipos nuevos.

## 6. Frontend (Stocka)

- Formulario de puerto `moving_head`: editor de posiciones (nombre + pan, tilt, zoom, intensidad, blanco,
  color; añadir, quitar, reordenar) con los rangos del perfil. La fila del puerto muestra cuántas tiene.
- Página del dispositivo, modo prueba del cabezal: deslizadores de pan, tilt, zoom, intensidad y blanco
  más el color, en vivo mientras está encendido; botones «Ves-hi» por posición guardada y «Desa com a
  posició» que crea o actualiza la posición en el puerto de Stocka con los valores actuales (PATCH del
  puerto). Los nombres de los puertos del show coinciden con los de Stocka.
- Mensajes de error `ports.position_invalid.*` en ca/es/en.

- App `belen-app` (misma UI que la página del dispositivo): deslizadores de pan/tilt/zoom/intensidad/blanco y
  color en el modo prueba del cabezal, botones «◎ posición» y «Desa com a posició». El store `headPositions`
  carga los puertos `moving_head` y los perfiles del catálogo de Stocka cuando el móvil tiene Internet y los
  guarda en Preferences (en el belén no suele haber Internet y las posiciones siguen a la vista); guardar una
  posición es un PATCH del puerto y necesita Internet y rol OWNER/MANAGER (el rol viaja ahora en la lista de
  dispositivos guardada, `SavedDevice.orgRole`).

## 7. Flujo de uso

1. En Stocka: tipo "Cabezal" (kind `moving_head`) con una acción "Posició" sobre `set` con `position`
   dinámico y `time` como duración (y, si se quiere, `intensity` dinámico), más "Apaga" sobre `blackout`.
2. Puertos: un `moving_head` por cabezal (direcciones 1, 16…), todos del tipo "Cabezal". Pieza(s) del tipo
   vinculadas a su puerto en el editor; con dos cabezales en una misma pieza, una pista por puerto o la
   general para moverlos a la vez.
3. Página del dispositivo: encender el cabezal, llevarlo con los deslizadores al Portal, «Desa com a
   posició» → "Portal". Repetir por posición y por cabezal.
4. Editor: clip "Posició" → desplegable "Portal", duración 3 s. Exportar y enviar.
5. Animaciones: una acción "Moviment" sobre `set` con `from_position` y `position` dinámicos y `time` como
   duración: el clip elige "Des de: Portal" y "Fins a: Estrella" y dura lo que tarda el recorrido. Para un
   barrido de ida y vuelta, dos clips seguidos.
