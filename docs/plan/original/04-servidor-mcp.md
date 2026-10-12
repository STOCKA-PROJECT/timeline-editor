# Fase 4 · Servidor MCP

**Duración:** 3–4 días (23–26 nov) · **Depende de:** fase 3 (capa de comandos)

## Objetivo

Que Claude pueda leer y modificar el proyecto con instrucciones en lenguaje natural, y que cada cambio aparezca al momento en la interfaz abierta en el navegador.

## Entregables

- Servidor MCP dentro de `packages/server`, construido con el SDK oficial de TypeScript.
- Conjunto de herramientas de lectura, edición, vista previa y dispositivo.
- Guía de convenciones que Claude puede consultar.
- Resaltado en la interfaz de los cambios con origen `mcp`.

## 1. Encaje en la arquitectura

```
Claude ──MCP──► server ──comando──► core ──cambios──► WebSocket ──► interfaz
```

El MCP no tiene lógica propia: cada herramienta de edición traduce su entrada a comandos de la fase 3. Por eso los cambios se validan igual, se pueden deshacer y se ven en vivo sin trabajo adicional.

**Transporte.** El servidor MCP debe compartir estado con el editor en marcha. Dos opciones:

- exponer MCP por HTTP desde el propio servidor del editor; o
- un proceso fino por entrada/salida estándar que reenvía al servidor del editor.

Antes de implementarlo, confirma en la documentación de MCP y de tu cliente de Claude qué transporte recomiendan en ese momento para servidores locales.

## 2. Herramientas

**Lectura**

| Herramienta | Devuelve |
|---|---|
| `get_project_summary` | Placa, número de salidas por tipo, duración, escenas, estado de validación |
| `list_outputs` | Salidas y entradas con ID lógico, tipo y dirección |
| `list_scenes` | Escenas y su contenido |
| `get_timeline` | Pistas y clips, con filtro por rango de tiempo o por salida |
| `describe_state_at` | Estado de todas las salidas en un instante, en texto |
| `validate_project` | Errores y avisos |
| `get_conventions` | Nomenclatura, tipos de clip y efectos disponibles |

**Edición**

| Herramienta | Comandos que usa |
|---|---|
| `add_output`, `update_output`, `rename_output` | `hardware.*` |
| `add_led_segment`, `create_group` | `led.*`, `group.*` |
| `create_scene`, `update_scene` | `scene.*` |
| `add_clip`, `update_clip`, `remove_clip` | `timeline.*` |
| `apply_commands` | Lote de comandos, atómico |
| `undo` | Deshace el último paso de Claude |

**Vista previa** (completa a partir de la fase 5)

| Herramienta | Función |
|---|---|
| `seek_preview` | Mueve el cursor de la interfaz a un instante |
| `play_preview` | Reproduce un tramo en la interfaz |

**Dispositivo**

| Herramienta | Función |
|---|---|
| `get_device_status` | Estado, show activo, último error |
| `test_output` | Activa una salida en modo prueba |
| `request_deploy` | Solicita subir el show; requiere confirmación en la interfaz |

## 3. Criterios de diseño

- **Un paso de deshacer por llamada.** Todo lo que cambia una llamada se agrupa, de modo que "deshaz lo último" tenga sentido.
- **Lotes.** `apply_commands` permite montar una secuencia entera (por ejemplo, un amanecer con diez clips) en una sola llamada y falla entera si un comando no valida.
- **Errores accionables.** Cuando algo no valida, la respuesta dice qué regla falla y qué valores serían válidos (por ejemplo, los canales libres de `exp1`).
- **Respuestas compactas.** IDs y resúmenes, no el proyecto completo. `get_timeline` siempre admite filtros.
- **`describe_state_at`** permite a Claude comprobar su propio trabajo sin ver la pantalla: "en el segundo 95 el cielo está en azul oscuro, la hoguera encendida y el ángel subiendo".
- **Convenciones.** `get_conventions` devuelve la nomenclatura del proyecto para que los nombres que cree Claude sigan el mismo patrón (`relay.`, `led.`, `scene.`...).

## 4. Límites de seguridad

- Subir un show al dispositivo siempre requiere pulsar "Confirmar" en la interfaz.
- El MCP no puede mover el motor del ángel; eso solo se hace desde la interfaz, manteniendo pulsado.
- `test_output` solo funciona si el modo prueba está abierto en la interfaz, y sus órdenes caducan solas.
- El MCP no puede cambiar el token del dispositivo ni la configuración de red.

## 5. Interfaz

- Los elementos modificados por Claude parpadean o quedan resaltados unos segundos.
- Panel de actividad con la lista de cambios de origen `mcp` y un botón para deshacer cada paso.
- Indicador de que hay un cliente MCP conectado.

## Tareas

- [ ] Servidor MCP y registro de herramientas.
- [ ] Herramientas de lectura.
- [ ] Herramientas de edición sobre la capa de comandos, con agrupación por llamada.
- [ ] `describe_state_at` usando el compilador.
- [ ] `get_conventions`.
- [ ] Confirmación de subida en la interfaz.
- [ ] Resaltado y panel de actividad.
- [ ] Conexión desde el cliente de Claude y prueba de extremo a extremo.

## Criterios de aceptación

Con la interfaz abierta, estas peticiones funcionan y se ven en vivo:

- "Añade un relé para el molino en el siguiente canal libre del expansor."
- "Crea un amanecer de 20 segundos en el cielo y enciende la hoguera en el segundo 5."
- "Los tres primeros edificios de la tira son la panadería, la posada y el establo, con 4, 6 y 5 LEDs."
- "¿Qué está encendido en el minuto 1:30?"
- "Deshaz lo último."
- Una petición inválida (canal ocupado, clip solapado) devuelve un error claro y no deja el proyecto a medias.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| El protocolo o el SDK cambian | Capa MCP fina y aislada en un solo módulo |
| Cambios grandes de Claude difíciles de revisar | Panel de actividad y deshacer por paso |
| Respuestas demasiado largas en proyectos grandes | Filtros y resúmenes en todas las lecturas |
