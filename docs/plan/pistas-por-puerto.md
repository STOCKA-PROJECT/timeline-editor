# Pistas por puerto (04-11-2026)

Complemento de [`puertos-por-tipo.md`](puertos-por-tipo.md). Con «un tipo manda a un solo puerto» un artículo con
**dos luces independientes** del mismo tipo («Llum») o con **dos motores** («Peça moviment») no tenía salida: o se
cableaban al mismo relé (se mueven juntos) o había que inventar un segundo tipo en el inventario de la organización
para un detalle de una sola pieza. Decisiones de Joan:

1. **Un tipo puede mover varios puertos.** El inspector ofrece una lista por tipo con «+ Un altre port». El nombre de
   cada salida es el nombre del puerto de la organización («Sortida 2», «Pastor llum dreta»); no hay nombres nuevos.
2. **La pista gana un `portId` opcional.** Una pista sin puerto se comporta como hasta ahora: sus clips disparan todos
   los puertos del artículo que hacen del tipo de la acción. Una pista con puerto dispara solo ese puerto. Así, el
   artículo con dos luces tiene una fila por relé en la línea de tiempo («Pastor · Llum dreta»), como en cualquier DAW.
3. **El clip debe encajar con el puerto de su pista.** La acción de un clip en una pista de puerto debe ser de un tipo
   que ese puerto hace para el artículo; si no, `E_TRACK_PORT_MISMATCH`. Una pista cuyo puerto el artículo ya no tiene
   es `E_TRACK_PORT_UNBOUND`.
4. **Mover todos a la vez sigue permitido, pero avisa.** Clips de un tipo en la pista general cuando el tipo mueve dos
   o más puertos → `W_PORTS_TOGETHER` («crea una pista por puerto para moverlos por separado»). Sustituye a
   `W_PORT_ROLE_DUPLICATE`, que ya no existe: varios puertos por tipo es un estado legítimo.
5. **El `show.json` no cambia.** Los eventos ya van por nombre de puerto (`target`), así que ni `rpi4-system` ni la app
   del belén se tocan y el hash golden de `belen-2026` no se mueve.

Alternativa descartada: poner el destino en el clip (`clip.ports`). Más flexible, pero cada clip necesitaría un
selector y la fila del artículo sería ilegible (dos `turn_on` superpuestos hacia relés distintos sin que nada lo muestre).

## Esquema de la escena

`SceneTrack.portId?: number` (uno de `item.ports`). Sin migración SQL: todo vive en el JSON. Las escenas existentes no
tienen el campo y se comportan igual que antes.

## Editor

- `utils/portRoles.ts`: `RoleGroup.playing` (lista de puertos que hacen del tipo, en orden de vinculación) sustituye a
  `selected` + `extras`; `addTypePort` (el tipo gana un puerto) y `moveTypePort` (una fila cambia de puerto sin tocar
  sus hermanas). `withTypePort` (exclusivo) se conserva.
- Inspector (`ClipInspector.vue`), bloque **Ports**: una fila `<select>` por puerto del tipo; con varias, cada fila tiene
  «×» (deja de hacer del tipo) y «Pista» (crea la pista del puerto; «té pista» si ya existe); «+ Un altre port» abre un
  desplegable sin selección. Aviso ámbar mientras algún puerto del tipo no tenga pista propia.
- Inspector, clip: si la pista tiene puerto, el desplegable de acciones solo ofrece las de los tipos que ese puerto hace y
  una nota dice «Pista del port «X»: el clip només mou aquesta sortida»; una acción que no encaja se marca en rojo. Si
  el artículo ya no tiene el puerto, botón «fes-la general».
- Línea de tiempo (`TimelinePanel.vue`): las pistas de un artículo van juntas (general primero, luego una por puerto),
  la cabecera muestra «Peça · Port» (en rojo si el puerto ya no está) y las pistas de puerto tienen «×» (confirma si
  hay clips). Doble clic en una pista de puerto crea un clip con la primera acción de un tipo que ese puerto hace.
- Store (`scene.ts`): `ensureTrackForItem` devuelve la primera pista **sin** puerto; `ensurePortTrack(itemId, portId,
  name)` la crea justo tras las pistas del artículo; `setTrackPort`, `removeTrack`, `tracksForItem`; `updateItem` con
  `ports` libera las pistas de los puertos que se desvinculan.
- `exportBundle.ts`: `ExecutionStep.portId` (solo cuando la pista lo tiene); `W_PORTS_TOGETHER` en el plan.
  `showPackage.ts`: el paso llega a los puertos del tipo de la acción **y**, con `portId`, solo a ese;
  `E_TRACK_PORT_MISMATCH` / `E_TRACK_PORT_UNBOUND`.

## Backend y MCP

- `SceneDocument.Track.portId` (`@JsonInclude(NON_NULL)`, `withPort`). `SceneJsonCodec.toJson` borra `portId` del árbol
  original cuando el modelo lo ha quitado (como ya hacía con `schedule`).
- `SceneOp`: `add_track {itemId, name?, port?}`, nuevo `set_track_port {trackId, port?}` (vacío = pista general),
  `add_clip {itemId, port?}` (la pista del puerto, creada si falta; `port` con `trackId` se rechaza). `SceneEditor`
  comprueba el tipo del clip contra el puerto de la pista en `add_clip`, `update_clip` y `move_clip`; `set_track_port`
  rechaza un puerto que no hace del tipo de algún clip de la pista (lista los clips); `set_item_ports` ya no rechaza
  dos puertos del mismo tipo y libera las pistas de los puertos que desvincula (lo dice en el `log`).
- `SceneValidator`: `E_TRACK_PORT_UNBOUND` (pista), `E_TRACK_PORT_MISMATCH` (clip), `W_PORTS_TOGETHER` solo cuando hay
  clips del tipo en una pista sin puerto. `SceneSummary.TrackSummary.port`. `ExecutionPlan.ExecutionStep.portId` y
  `ShowPackageBuilder` filtran igual que el editor.
- `mcp/guide.md`, `scene.schema.json` y las descripciones de `SceneOp` al día.
- Tests: `SceneJsonCodecTest`, `SceneEditorTest`, `SceneValidatorTest`, `ShowPackageBuilderTest` (clases `TrackPorts`),
  `portRoles.test.ts`, `showPackage.test.ts`; el golden hash no se mueve y una escena con dos relés en pistas de puerto
  da el mismo hash que dos artículos separados.
