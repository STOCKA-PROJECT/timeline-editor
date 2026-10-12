# Fase 1 · Formato del show, compilador y pruebas en banco

**Duración:** 1 semana (12–18 oct) · **Depende de:** nada · **Nomenclatura:** ver `00-vision-general.md`, sección 4

## Objetivo

Dejar cerrado el contrato entre editor y reproductor antes de escribir ninguno de los dos, y despejar las dudas del hardware nuevo de este año (expansor de relés, ángel, proyector).

## Entregables

- Esquema del proyecto fuente (`project.json`) en `packages/core`, definido con Zod y exportado a JSON Schema.
- Perfil de placa `boards/rpi4b.json`.
- Compilador `project.json → show.belen` y CLI: `belen validate`, `belen compile`.
- Especificación del paquete compilado.
- Informe de banco con medidas reales (tiempos del ángel, latencias, consumo).

## 1. Proyecto fuente (`project.json`)

Es lo que edita la persona (o Claude). Se guarda en una carpeta con sus audios, apta para git.

| Sección | Contenido |
|---|---|
| `meta` | Nombre, versión de formato, autor |
| `hardware` | `board`, `ports`, `outputs`, `inputs` (ver nomenclatura) |
| `groups` | Conjuntos de salidas: `"group.casas": ["led.casa-herrero", "led.posada"]` |
| `scenes` | Estados con nombre |
| `timeline` | Duración, pistas y clips |
| `triggers`, `idle` | Qué arranca el show y qué se ve en reposo |
| `layout` | Posición de cada elemento en la vista previa (fase 5; no se envía al dispositivo) |

```json
"scenes": {
  "scene.noche":  { "led.cielo": "#001040", "group.casas": "#ffb060", "relay.hoguera": 1 },
  "scene.reposo": { "group.casas": "#402810" }
},
"timeline": {
  "durationMs": 180000,
  "tracks": [
    { "target": "scenes", "clips": [
      { "type": "scene", "startMs": 90000, "scene": "scene.noche", "fadeMs": 15000 }
    ]},
    { "target": "group.casas", "clips": [
      { "type": "fade", "startMs": 0, "endMs": 20000, "from": "#000000", "to": "#ffb060" }
    ]},
    { "target": "motor.angel", "clips": [
      { "type": "motor", "startMs": 60000, "action": "up" },
      { "type": "motor", "startMs": 120000, "action": "down", "durationMs": 6500 }
    ]},
    { "target": "audio.principal", "clips": [
      { "type": "audio", "startMs": 0, "file": "audio/villancico.mp3" }
    ]}
  ]
},
"triggers": [ { "on": "button.inicio", "do": "play" } ],
"idle": "scene.reposo"
```

## 2. Tipos de salida

| Tipo | Canales por fotograma | Valor | Notas |
|---|---|---|---|
| `relay` | 1 byte | 0 / 1 | `activeLow`, `safe`, intervalo mínimo entre conmutaciones |
| `dimmer` | 1 byte | 0–255 | Curva gamma opcional |
| `led` | 3 bytes por píxel | RGB | El fotograma lleva la tira entera; el segmento es un rango |
| `spot` | 1 byte | Intensidad | La posición se calcula en el reproductor siguiendo al motor |
| `motor` | Ninguno | — | Va por eventos |
| `audio` | Ninguno | — | Va por eventos |

## 3. Tipos de clip

| Clip | Aplica a | Parámetros |
|---|---|---|
| `set` | relay, dimmer, led, spot | `value` |
| `fade` | dimmer, led, spot | `from`, `to`, `easing` |
| `effect` | led | `name` (parpadeo, fuego, estrellas, barrido), parámetros, `seed` fija |
| `scene` | Pista `scenes` | `scene`, `fadeMs` |
| `audio` | audio | `file`, `offsetMs`, `volume` |
| `motor` | motor | `action: up` (hasta sensor) o `action: down` + `durationMs` |

**Prioridad cuando varios clips afectan a la misma salida:** escena < pista de grupo < pista individual. Dos clips solapados en la misma pista son un error de validación.

**Motor:** el tiempo máximo de marcha (`maxRunMs`) es una propiedad del hardware, no del clip, para que ningún show pueda saltárselo. Un clip `up` sin sensor configurado no valida.

## 4. Paquete compilado (`show.belen`)

Un zip con:

| Fichero | Contenido |
|---|---|
| `manifest.json` | Versión de formato, `board`, hash, fps, duración, mapa de canales (salida → desplazamiento y longitud) |
| `hardware.json` | Copia de `hardware` para que el reproductor configure los drivers |
| `frames.bin` | Cabecera (`BLN1`, fps, nº de canales, nº de fotogramas) + fotogramas sin comprimir |
| `events.json` | Lista ordenada por tiempo: `audio.play`, `audio.stop`, `motor.move`, `motor.stop` |
| `idle.bin` | Un único fotograma con el estado de reposo |
| `audio/` | Ficheros de sonido |

Tamaño orientativo: 300 píxeles + 32 relés + 4 dimmers + 1 foco = 937 bytes por fotograma. A 30 fps y 5 minutos son unos 8,4 MB, más el audio.

## 5. Compilador

1. Validar el esquema y las reglas (lista abajo).
2. Expandir grupos y escenas a salidas individuales.
3. Para cada fotograma, resolver el valor de cada canal aplicando la prioridad de pistas.
4. Generar los eventos de audio y motor.
5. Empaquetar y calcular el hash.

El compilador es determinista: mismo proyecto, mismo hash. Los efectos usan semilla fija.

**Validaciones de esta fase:** dirección física duplicada · pin inexistente o reservado en la placa · segmentos de LED solapados o fuera de rango · capacidad no disponible en la placa · clips solapados · motor sin sensor o sin `maxRunMs` · fichero de audio ausente.

## 6. Pruebas en banco

- [ ] **Relés con MCP23017.** Confirmar si la placa de relés es activa a nivel bajo y qué hace al arrancar y al reiniciar la RPi. Ningún relé debe activarse solo.
- [ ] **Pines nativos.** Anotar qué pines de la RPi arrancan con resistencia a positivo (los GPIO bajos) y evitarlos para cargas.
- [ ] **WS2812B por SPI** (`gpio:10`) con conversor de nivel, sonando audio a la vez. Revisar en el README de `rpi_ws281x` los ajustes que pide el modo SPI.
- [ ] **Consumo de LEDs.** Medir con todo en blanco y dimensionar fuente e inyección (regla: hasta 60 mA por píxel).
- [ ] **Ángel.** Medir tiempo de subida y de bajada varias veces. Fijar `maxRunMs` en torno a 1,3 veces la subida más lenta. Probar el fallo: sensor desconectado.
- [ ] **Proyector.** Pantalla completa en negro con un círculo; decidir la tecnología (SDL/pygame sin escritorio o navegador en modo quiosco) y medir el retardo.
- [ ] **Audio.** Jack frente a tarjeta USB; medir el retardo entre la orden y el sonido.

## 7. Criterios de aceptación

- `belen compile` genera un paquete a partir de un proyecto de ejemplo con todos los tipos de salida.
- Compilar dos veces da el mismo hash.
- Cada validación tiene un proyecto de prueba que la dispara.
- El informe de banco tiene todos los números que necesitan las fases 2 y 5.

## 8. Riesgos

| Riesgo | Mitigación |
|---|---|
| Rediseñar el formato a mitad de proyecto | Campo de versión desde el primer día y proyecto de ejemplo completo antes de cerrar |
| Interferencia entre LEDs y audio | Probarlo en banco esta semana, no en el montaje |
| El proyector no arranca sin escritorio | Tener el navegador en modo quiosco como alternativa |
