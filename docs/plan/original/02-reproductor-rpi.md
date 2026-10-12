# Fase 2 · Reproductor en la Raspberry Pi

**Duración:** 2 semanas (19 oct – 1 nov) · **Depende de:** fase 1

## Objetivo

Un servicio en la RPi que carga un `show.belen`, lo ejecuta de forma fiable y se gestiona por WiFi. Al terminar esta fase ya no hace falta meterse debajo del belén: el show se escribe en JSON, se compila en el portátil y se sube con un comando.

## Entregables

- Servicio `belen-player` (Python 3, asyncio) gestionado por systemd.
- API HTTP + WebSocket.
- Comandos de CLI en el portátil: `belen deploy`, `belen status`, `belen rollback`.
- El show del año pasado portado al formato nuevo, con ángel y proyector añadidos.

## 1. Estructura

Los nombres de módulo se repetirán en el firmware del ESP32.

```
player-rpi/
  loader.py        # abre el paquete, comprueba hash, board y esquema
  clock.py         # reloj maestro (audio o monotónico)
  frame_player.py  # lee frames.bin y escribe en los drivers
  events.py        # ejecuta events.json
  inputs.py        # botones y sensores con antirrebote
  state.py         # máquina de estados
  storage.py       # shows guardados, activo y anterior
  api.py           # HTTP y WebSocket
  drivers/
    gpio.py  mcp23017.py  ws2812b.py  audio.py  video_spot.py  motor.py
```

Todos los drivers exponen lo mismo: `begin(config)`, `write(valores)`, `safe()`.

## 2. Máquina de estados

```
BOOT → SAFE → IDLE ⇄ PLAYING
                ⇅
               TEST          cualquier estado → ERROR → SAFE
```

| Estado | Qué ocurre |
|---|---|
| `BOOT` | Lo primero es poner todas las salidas en seguro, antes de cargar nada |
| `SAFE` | Relés apagados, motor parado, LEDs a negro |
| `IDLE` | Se muestra el fotograma de reposo; se atienden disparadores |
| `PLAYING` | Reproducción del show; los disparadores se ignoran |
| `TEST` | Control manual desde el portátil; solo se entra desde `IDLE` |
| `ERROR` | Se registra la causa, se pasa a seguro y se intenta volver a `IDLE` |

## 3. Reproducción

- El fotograma a mostrar se calcula a partir del reloj, no contando vueltas del bucle. Si el sistema va tarde se saltan fotogramas en lugar de acumular retraso.
- **Reloj maestro:** si el show tiene audio, la posición del reproductor de audio (por ejemplo `mpv` consultado por su canal de control); si no, reloj monotónico.
- Relés y dimmers solo se escriben cuando cambian (ahorra tráfico I2C). Las tiras se envían enteras.
- Los eventos se disparan cuando el reloj supera su marca de tiempo.

## 4. Ángel y foco

**Motor**

- Al arrancar se hace una subida hasta el sensor para conocer la posición.
- `up`: marcha hasta que el sensor se activa o se cumple `maxRunMs`. Si vence el tiempo máximo: parar, registrar error y marcar el motor como bloqueado hasta intervención manual.
- `down`: marcha durante `durationMs`. Como cada subida vuelve a referenciar en el sensor, el error no se acumula entre ciclos.
- El driver nunca deja el motor alimentado sin una orden con fecha de caducidad.
- Recomendado: cablear el final de carrera para que corte también por hardware.

**Foco**

- Pantalla completa en negro con un círculo blanco.
- Posición = interpolación entre `top` y `bottom` según la posición estimada del motor (0 abajo, 1 en el sensor). La estimación usa los tiempos medidos en banco y se corrige a 1 cuando salta el sensor.
- La intensidad viene del fotograma, como un dimmer.

## 5. API

Cada ruta corresponde a un mensaje de protocolo con el mismo nombre, para poder reutilizarlo sobre Bluetooth o serie en la fase 6.

| Método | Ruta | Mensaje | Función |
|---|---|---|---|
| GET | `/api/info` | `hello` | Placa, versión, capacidades, hash del show activo, espacio libre |
| GET | `/api/status` | `status` | Estado, tiempo de reproducción, entradas, último error |
| PUT | `/api/shows/{hash}` | `show.put` | Sube un paquete |
| POST | `/api/shows/{hash}/activate` | `show.activate` | Lo marca como activo |
| POST | `/api/rollback` | `show.rollback` | Vuelve al anterior |
| POST | `/api/play`, `/api/stop`, `/api/panic` | `play`, `stop`, `panic` | Control de reproducción |
| POST | `/api/test/set`, `/api/test/release` | `test.set`, `test.release` | Modo prueba |
| POST | `/api/motor/jog` | `motor.jog` | Mover el ángel a mano |
| GET | `/api/logs` | `logs` | Últimos registros |
| WS | `/api/live` | — | Estado continuo y control manual |

Acceso protegido con un token fijo en cabecera. El dispositivo solo se expone en la red local.

## 6. Subida atómica y vuelta atrás

```
/var/lib/belen/
  shows/<hash>/     # paquetes descomprimidos
  active  → shows/<hash>
  previous → shows/<hash>
  incoming/         # subidas en curso
```

1. El paquete se recibe en `incoming/`.
2. Se comprueba hash, versión de formato, `board` y esquema.
3. Solo si todo es correcto se mueve a `shows/` y se cambia el enlace `active` (operación atómica). El anterior pasa a `previous`.
4. Si el show activo falla al cargar en un arranque, se usa `previous`; si tampoco carga, se queda en `SAFE` con la API disponible.

Nunca se activa un show durante `PLAYING`: se aplica al terminar el ciclo o tras un `stop`.

## 7. Estado seguro

- Valor `safe` por salida (por defecto apagado).
- Se aplica en el arranque, al parar el servicio, ante cualquier excepción y con `panic`.
- systemd con reinicio automático y vigilancia: si el bucle se cuelga, se reinicia el servicio.
- `panic` también está en el botón físico (pulsación larga).

## 8. Modo prueba

- Activar o regular cualquier salida por su ID lógico; elegir color en un segmento de LED.
- Cada orden caduca sola (por ejemplo a los 60 s) para no dejar nada encendido por olvido.
- Mover el ángel exige mantener la orden: caduca a los 500 ms si no se renueva.
- Sirve para cablear, identificar relés y calibrar el foco.

## 9. Disparadores y reposo

- Botón con antirrebote; ignorado mientras hay un show en marcha; tiempo de espera opcional entre pases.
- Horario opcional: horas en las que el belén está activo y horas en las que queda apagado.
- En reposo se muestra `idle.bin`.

## 10. Red

- La RPi se une a las redes WiFi conocidas; si no encuentra ninguna, crea la suya (`belen-setup`).
- Nombre en la red local: `belen1.local`.

## Tareas

- [ ] Drivers con modo simulado (escriben a fichero en lugar de al hardware) para probar en el portátil.
- [ ] `loader`, `frame_player`, `clock`, `events`.
- [ ] Máquina de estados y estado seguro.
- [ ] Motor y foco con los datos del banco.
- [ ] `storage` con subida atómica y vuelta atrás.
- [ ] API, token y modo prueba.
- [ ] Servicio systemd, red y nombre local.
- [ ] `belen deploy/status/rollback` en la CLI.
- [ ] Portar el show del año pasado.

## Criterios de aceptación

- 20 pases seguidos sin intervención y sin desfase apreciable entre audio y luces.
- Cortar la corriente a mitad de show: al volver arranca en reposo, sin relés activados ni motor en marcha.
- Subir un paquete corrupto o de otra placa: se rechaza y sigue el show anterior.
- Desconectar el sensor del ángel: el motor para por tiempo máximo y queda registrado.
- La salida de los drivers simulados coincide con los fotogramas del compilador.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| Desfase de audio con el paso de los minutos | Reloj maestro en el audio, no en el bucle |
| Tarjeta SD corrupta por cortes de corriente | Escrituras mínimas; valorar sistema de ficheros de solo lectura con una partición de datos |
| Bloqueo del proceso con el motor en marcha | Orden con caducidad en el driver y corte por hardware en el final de carrera |
