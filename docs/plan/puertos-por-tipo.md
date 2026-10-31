# Un puerto por tipo (31-10-2026)

Complemento de los roles por puerto (`portTypes`, 30-10-2026). Hasta ahora el inspector del editor ofrecía, por cada
tipo con salida de un artículo, una lista de casillas con todos los puertos de ese `kind`, y nada impedía marcar
varios para el mismo tipo. Decisiones de Joan:

1. **Un tipo manda a un solo puerto.** «Llum» de un artículo es un relé, no varios. Un artículo con tres bombillas
   que van juntas se cablea a un relé o se le da un tipo por salida.
2. **Un artículo con dos tipos del mismo `kind`** («Llum» y «Peça moviment», ambos relés) tiene un desplegable por
   tipo y puede elegir el **mismo puerto** en los dos. Entonces las pistas de ambos tipos mueven ese relé; se
   permite, pero se avisa.
3. **El MCP también lo rechaza:** `set_item_ports` / `add_item` fallan si dos puertos harían del mismo tipo.

## Editor

- Inspector: un `<select>` por tipo con salida del artículo. Opción «Sense port» y una por cada puerto del `kind`,
  con sufijos: pin, «en ús: Pastor, Ovella» (artículos del tablero que ya lo usan; en una tira, «a la tira: …») y
  «fa de “Llum”» cuando el otro tipo de este mismo artículo ya lo tiene. Todo seleccionable: compartir un puerto
  entre artículos ya estaba permitido (cuadro «També a “…”»).
- Elegir un puerto para un tipo quita ese tipo de cualquier otro puerto del ítem; un puerto que se queda sin
  tipos se desvincula. Así «un puerto por tipo» se cumple por construcción (`withTypePort` en `utils/portRoles.ts`).
- Escenas antiguas con dos puertos para el mismo tipo: el desplegable muestra el primero y un cuadro rojo lista los
  demás con «Treu» (`withoutRole`).
- Aviso ámbar cuando un puerto hace de dos tipos del artículo («les dues pistes mouen el mateix relé»).
- `exportBundle.ts`: un `ExecutionPort` por rol del puerto (así `showPackage.ts` sigue filtrando por
  `pieceTypeId` sin cambios), más `W_PORT_SHARED_ROLES` y `W_PORT_ROLE_DUPLICATE`.

## Esquema de la escena

`item.portTypes` sigue siendo «id de puerto → tipo que hace», pero el valor puede ser **un id de tipo o una lista**
de ids cuando el puerto hace de varios tipos del artículo. Se escribe un número cuando es uno solo, así las escenas
existentes no cambian ni un byte. Un puerto sin entrada sigue haciendo de su propio tipo. No hay migración SQL: todo
vive en el JSON de la escena. El `show.json` que recibe la Raspberry no cambia (los eventos ya van por nombre de
puerto), así que ni `rpi4-system` ni la app del belén se tocan.

## Backend y MCP

- `SceneDocument.Item.portTypes` pasa a `Map<Integer, List<Integer>>` con (de)serializador propio (número o lista
  al leer; número si hay un solo rol al escribir). `portRole(...)` → `portRoles(...)`.
- `SceneValidator`, `SceneSummary` y `ExecutionPlan` recorren los roles de cada puerto; `ExecutionPlan` añade un
  `ShowPort.playing(rol)` por rol. Nuevos avisos `W_PORT_SHARED_ROLES` (un puerto hace de varios tipos del
  artículo) y `W_PORT_ROLE_DUPLICATE` (varios puertos hacen del mismo tipo; escenas antiguas).
- `SceneEditor.resolvePorts`: el valor de `portTypes` admite `"Llum"` o `["Llum", "Moviment"]` y rechaza que dos
  puertos hagan del mismo tipo. Descripciones de `SceneOp`, `mcp/guide.md` y `docs/mcp.md` al día.
- Tests: `SceneJsonCodecTest`, `SceneEditorTest`, `SceneValidatorTest`, `ShowPackageBuilderTest`; el golden hash de
  `belen-2026` no se mueve.
