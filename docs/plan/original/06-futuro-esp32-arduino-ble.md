# Fase 6 · Segundo controlador (ESP32 / Arduino) y Bluetooth

**Cuándo:** después de Navidad · **Depende de:** fases 1 a 3

## Objetivo

Que el mismo editor, el mismo formato y los mismos nombres sirvan para un segundo belén con otro controlador. Esta fase no se implementa ahora, pero condiciona decisiones de las fases anteriores; las que hay que respetar desde el principio están en la sección 1.

## 1. Lo que hay que respetar ya

- Ningún pin ni detalle de placa fuera de la sección `hardware`: el perfil en `board`, los pines de `ports` y el campo `at` de cada salida o entrada. Escenas, línea de tiempo y disparadores solo usan IDs lógicos.
- El paquete compilado no asume Linux: ficheros planos que se puedan leer en streaming desde una microSD.
- El reproductor no necesita interpretar el proyecto fuente, solo fotogramas y eventos.
- Los mensajes de protocolo son independientes del transporte (HTTP hoy; Bluetooth o serie mañana).
- Mismos nombres de módulos y de operaciones de driver en todos los reproductores.

## 2. Perfiles de placa

Cada perfil es un fichero en `boards/` con pines válidos, pines reservados y capacidades. El editor lo usa para ofrecer solo opciones posibles y para validar.

| Capacidad | `rpi4b` | `esp32-devkit` | `arduino-mega` |
|---|---|---|---|
| Relés por MCP23017 | Sí | Sí | Sí |
| WS2812B | Sí (SPI) | Sí | Sí, pocos píxeles |
| Dimmer PWM | Sí | Sí | Sí |
| Audio | Jack o USB | I2S (por ejemplo MAX98357A) | Módulo MP3 externo |
| Vídeo y foco | HDMI | No | No |
| Transporte | WiFi | WiFi y Bluetooth | Serie; Bluetooth con módulo |
| Almacenamiento | SD del sistema | microSD o memoria interna | microSD |
| Show | Completo | Completo, sin foco | Reducido |

Ejemplos de pines reservados que el perfil debe conocer en un ESP32: los de arranque, los conectados a la memoria flash y los que solo son de entrada.

## 3. Nomenclatura: qué cambia y qué no

| Elemento | Entre placas |
|---|---|
| IDs lógicos (`relay.herrero`, `led.casa-herrero`...) | Idénticos |
| Puertos (`exp1`, `strip1`, `audio1`) | Idénticos; cambia el pin |
| Direcciones `exp1:3`, `strip1:0-5` | Idénticas |
| Direcciones `gpio:n` | Cambia el número |
| Escenas, línea de tiempo, disparadores | Idénticos |
| Salidas que la placa no soporta (`spot.*`) | Se eliminan; el validador las señala |

Función prevista en el editor: **"Duplicar para otra placa"**, que copia el proyecto, cambia `board`, marca los `gpio:n` que hay que reasignar y lista las salidas no soportadas.

## 4. Firmware ESP32

```
player-esp32/            # C++ con PlatformIO
  loader      clock      frame_player    events
  inputs      state      storage         api
  drivers/  gpio  mcp23017  ws2812b  audio_i2s  motor
```

| Aspecto | Diferencia respecto a la RPi |
|---|---|
| Lectura de fotogramas | En streaming desde la tarjeta, sin cargar el fichero en memoria |
| Audio | Decodificación en el propio chip hacia un amplificador I2S; formatos más limitados |
| Reloj maestro | Muestras de audio reproducidas |
| Subida | Mismas rutas HTTP; paquete sin comprimir o descompresión por partes |
| Vuelta atrás | Dos carpetas (`active` y `previous`) en la tarjeta |
| Estado seguro | Perro guardián del chip; salidas en seguro al principio del arranque |
| Sin foco | El validador impide salidas `spot` con este perfil |

Añadidos al formato si hacen falta: compresión simple de `frames.bin` y lista de formatos de audio admitidos por placa.

## 5. Arduino clásico (perfil reducido)

Solo si se quiere reutilizar una placa existente. Limitaciones a reflejar en el perfil:

- Memoria muy limitada: pocos píxeles y fotogramas leídos uno a uno desde la tarjeta.
- Sin red: el show se carga por cable serie o copiando la tarjeta.
- Audio con módulo MP3 externo, que reproduce ficheros de su propia tarjeta; el audio no se puede subir a distancia.
- Sin efectos calculados en la placa (ya los resuelve el compilador, así que no es un problema).

Si se compra placa nueva, ESP32.

## 6. Transporte Bluetooth (opcional)

- Servicio BLE con dos características: una de escritura (mensajes troceados) y una de notificación (estado).
- Mismos mensajes que la API HTTP: `hello`, `status`, `show.put`, `show.activate`, `play`, `stop`, `test.set`...
- Subida por trozos con número de secuencia, verificación de hash al final y reanudación.
- Adecuado para shows sin audio o para cambiar ajustes; lento para ficheros de sonido.
- Uso más útil: configurar la WiFi del dispositivo la primera vez.
- En el portátil: desde el servidor Node con una librería BLE, o desde el navegador con Web Bluetooth (solo navegadores basados en Chromium).

En `packages/server` la conexión al dispositivo se define como una interfaz (`DeviceTransport`) con una implementación HTTP en la fase 3; Bluetooth y serie se añaden aquí sin tocar el resto.

## 7. Otras mejoras para después

- Empaquetar el editor como aplicación de escritorio.
- Biblioteca de efectos de LED ampliada.
- Varios controladores sincronizados en un mismo belén.
- Copias de seguridad y exportación de proyectos.
- Disparadores adicionales: sensor de presencia, mando a distancia.

## Tareas

- [ ] Perfil `esp32-devkit` y validaciones de capacidades.
- [ ] "Duplicar para otra placa".
- [ ] Firmware: drivers, lectura en streaming, audio.
- [ ] API HTTP con las mismas rutas.
- [ ] Interfaz `DeviceTransport` y transporte serie.
- [ ] Transporte BLE y configuración inicial de WiFi.
- [ ] Perfil `arduino-mega` reducido, si se necesita.

## Criterios de aceptación

- El proyecto del belén 1, duplicado para ESP32 y con los pines reasignados, compila sin tocar escenas ni línea de tiempo.
- El mismo paquete (salvo `board` y salidas no soportadas) se reproduce igual en ambos controladores.
- El editor no distingue entre dispositivos más allá del perfil de placa.
- Modo prueba, subida y vuelta atrás funcionan igual en el ESP32.
