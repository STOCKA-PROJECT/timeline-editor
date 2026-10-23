# Sensores que miden un valor (23-10-2026)

Complemento de [motores-y-sensores.md](motores-y-sensores.md). Hasta ahora un `sensor` era una entrada digital
(activo o no). Algunos sensores miden un valor (distancia, temperatura…) y lo que interesa es cuándo ese valor pasa
de un umbral. En lugar de un kind por magnitud, el sensor gana un campo `source` y el **modelo** decide qué mide y
cómo se conecta, como ya hacen los cabezales DMX con `profiles.moving_head`.

## Contrato

- `source`: `digital` (por defecto, todo igual que antes) o `measured`.
- Un sensor `measured` lleva `model` (un perfil de `profiles.sensor`), `threshold`, `activeWhen` (`below`: activo con
  valor ≤ umbral; `above`: con valor ≥ umbral), y opcionalmente `hysteresis` (margen para soltarse), `pollMs` y
  `quantity` (obligatoria si el modelo mide más de una magnitud). No lleva `expander`, `channel`, `activeLow` ni `pull`.
- Cada perfil declara `wiring` (`i2c`, `onewire`, `trig_echo`), `addresses` (I2C; la primera es la de por defecto),
  `quantities` (`{unit, min, max}`) y `pollMs`. Según el cableado, el puerto lleva `bus` + `address`, `pin` (del puerto)
  + `deviceId`, o `pinTrig` + `pinEcho`.
- Modelos iniciales: `vl53l0x` (distancia láser, I2C 0x29), `hc-sr04` (ultrasonidos, TRIG/ECHO), `ds18b20`
  (temperatura, 1-Wire) y `bme280` (temperatura, humedad o presión, I2C 0x76/0x77).
- Validación (`validate.py`, `ShowValidator`, `showValidate.ts`): `E_SENSOR_CONFIG` para cualquier incoherencia; los
  sensores I2C comparten con los expansores la unicidad de dirección por bus (`E_I2C_ADDRESS_DUPLICATE`, con la
  dirección por defecto del perfil) y la reserva de los GPIO 2 y 3; `pinTrig`/`pinEcho` cuentan como pines.

Para el motor no cambia nada: el sensor sigue siendo «activo o no» y puede ser `limitForward`/`limitReverse`.

## Reproductor

`app/drivers/meters.py` tiene un driver por modelo (`Vl53l0xMeter` con la librería de Adafruit, `Bme280Meter` con
RPi.bme280, `Ds18b20Meter` por sysfs, `HcSr04Meter` con RPi.GPIO) y `FakeMeter` fuera de la Pi. El `InputController`
lee cada sensor medido en su propio hilo cada `pollMs`, aplica el umbral con histéresis y después el mismo antirrebote
que a los digitales. Sin lectura, el sensor está inactivo. `status.sensors` añade `value`, `unit`, `threshold` y
`activeWhen`, que muestran la página local, la app y el editor.

Añadir un modelo = un perfil en `contract/catalog.json` (y sus copias) + un driver en `meters.py` + su valor en el
enum `model` del catálogo y del esquema.

## Plataforma

- Backend: `SensorProfile` en `OutputCatalog`; `PortConfigValidator` → `ports.sensor_config_invalid` con
  `params.reason`; `PortService` exige `Port.pin` a los 1-Wire, lo rechaza en el resto y aplica las reglas I2C
  (`ports.i2c_address_conflict`, `ports.i2c_pin_reserved`). Sin migración: la configuración es JSON.
- Frontend: tercera conexión del sensor «Sensor que mesura un valor»; el formulario muestra solo los campos del
  modelo, el umbral con la unidad y el rango de la magnitud, y las notas de cableado del perfil.

## El sensor del ángel

El sensor que hay hoy (módulo IR tipo FC-51 con comparador LM393 y potenciómetro) es **digital**: la distancia se
ajusta con el potenciómetro y se configura como sensor `digital`. El tipo `measured` es para cuando se monte un
VL53L0X u otro modelo que dé el valor.
