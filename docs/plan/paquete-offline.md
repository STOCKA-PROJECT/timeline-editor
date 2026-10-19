# Belén · Paquete autocontenido y entrega a la RPi sin Internet · Plan de implementación

**Versión 2 · 19 de octubre de 2026.** Sustituye a la versión 1 de este mismo día (que suponía Bluetooth obligatorio) y revisa las fases 2, 3 y 6 del [plan unificado](README.md). El contrato de la sección 4 del plan unificado (catálogo y paquete `stocka-show` v2) **no cambia**; se añade un formato de **paquete autocontenido** y se decide cómo llega al belén.

## 0. Qué se pide

- Donde esté instalada la RPi **posiblemente no haya Internet**, o muy poca.
- Por tanto: **antes**, en el ordenador o en el móvil (con Internet), se descarga **un zip con todo** lo que el show va a usar (el `show.json` y sus ficheros de audio y vídeo), y **después** se le pasa a la RPi **sin Internet por medio**.
- Bluetooth no es obligatorio. Más adelante habrá una **app móvil** que corte cualquier puerto al instante y cargue cualquier timeline de la cuenta.
- Una vez instalada en su sitio **habrá poco acceso físico a la RPi**. Cada vez que se encienda tiene que quedar **lista para recibir por esa vía por sí sola**: sin teclado, sin pantalla, sin que nadie toque nada (sección 5.5).
- **Cualquier portátil o móvil de la asociación** debe poder llevar el show, no solo el de Joan: ningún paso puede depender de este ordenador (ni del acceso SSH, ni del hotspot conocido, ni de claves guardadas aquí). Lo único que hace falta es una cuenta de Stocka con acceso a la organización y la etiqueta de la caja (sección 2.3).

Qué cambia respecto al plan unificado:

| Plan unificado | Este plan | Por qué |
|---|---|---|
| Fase 3: CLI `belen deploy` por red local; pantalla Dispositivo solo en `localhost` | **La propia RPi sirve una página web local** donde se suelta el zip | Funciona desde cualquier navegador y móvil sin Internet, sin CLI y sin el problema HTTPS→HTTP del editor desplegado |
| Los ficheros de audio «viajan aparte» (fase 3) | Viajan **dentro del paquete** `.belen.zip` | Es la única forma de que todo llegue sin red |
| Fase 6: la RPi descarga de la nube con su token | Opcional. La RPi no necesita Internet nunca; si lo tiene, solo informa de su estado | El sitio no tiene red |
| Principio 3: «el dispositivo nunca necesita entrada» | Entrada **solo por la red local** (hotspot del móvil o del portátil, o AP propio de la RPi); ningún puerto expuesto a Internet | La red local es el perímetro; PIN para escribir |

## 1. Hechos comprobados el 19 de octubre

| Dónde | Hecho | Consecuencia |
|---|---|---|
| RPi (`ssh rpi4b`) | Debian 13, NetworkManager activo con `dnsmasq-base`; `wlan0` soporta modo **AP**; conexiones Wi-Fi conocidas: hotspot del portátil (`HPMARTOOMEN`, activa) y **hotspot del móvil (`Realme`)** | La RPi ya trabaja sobre hotspots sin Internet; puede crear el suyo con `nmcli dev wifi hotspot` sin instalar nada |
| RPi | `avahi-daemon` activo; `flask` en el sistema, `aiohttp` no; pantalla HDMI conectada; Python 3.13 | `rpi4b.local` por mDNS, servidor HTTP en el venv |
| Portátil (Windows) | `rpi4b.local` **se resuelve** por mDNS y el portátil **llega directo** a la RPi por el hotspot | La página de la RPi se abre en el navegador del portátil tal cual |
| Tamaños | Show de muestra 5,8 KB; audios actuales de 0,7 a 14 MB | Por Wi-Fi local el zip entero tarda segundos |
| `rpi4-system` | `core.py` es un bucle bloqueante con hilos por acción; sin red; relés y motor escriben solo por `set_gpio`, LEDs por los objetos NeoPixel; el despacho pasa por `_execute_action`; autoarranque desactivado desde hoy | Reescritura del núcleo prevista (fase 2); el corte por puerto se impone en tres puntos |
| `timeline-editor` | `buildShowPackage` genera y hashea en el cliente; `meta.assets` ya lista cada audio con `attachmentId`, nombre, tamaño; los bytes se sirven por el BFF en `/api/organizations/{slug}/pieces/{id}/attachments/{aid}/content`; sin librería zip en `package.json` | El zip se construye en el navegador con lo que ya hay más una librería pequeña |
| `backend` | Sin generación de show en servidor; Flyway en V23 | Nada obligatorio para la fase A; el paquete en servidor (fase C) es lo que necesita la app |
| Bluetooth | BlueZ 5.82 con LE; `bluez-peripheral` instala; Web Bluetooth solo en Chromium y a 5–20 KB/s | Queda como opción para control desde el móvil, no para el zip (ver apéndice) |

## 2. Diseño en una frase

**El `.belen.zip` es la unidad de entrega.** Se genera con Internet (editor, y más adelante backend y app), se guarda donde haga falta (disco o móvil) y la RPi lo **importa desde cualquier origen con el mismo código**: página web local, app o, si algún día interesa, Bluetooth.

### 2.1 Formato `stocka-bundle` v1

```
belen-2026-6e46887d.belen.zip
├── manifest.json          # qué contiene y cómo comprobarlo
├── show.json              # paquete stocka-show v2, sin cambios
└── assets/
    ├── audio/12-nature.mp3    # nombre de activo = <attachmentId>-<fichero>, inmutable
    └── video/…
```

`manifest.json`:

```json
{
  "format": "stocka-bundle", "version": 1,
  "show": { "hash": "sha256:6e46…", "name": "Belén 2026", "timelineId": 12, "board": "rpi4b" },
  "files": [
    { "path": "show.json", "sha256": "…", "size": 5770 },
    { "path": "assets/audio/12-nature.mp3", "sha256": "…", "size": 3773952, "kind": "audio" }
  ],
  "createdAt": "2026-10-20T18:00:00Z", "createdBy": "editor 1.4 | backend | app"
}
```

Reglas:

- El zip es **completo**: contiene todos los activos que `show.json` referencia en `assets`. Audio y vídeo se guardan sin comprimir (ya lo están); el JSON, con deflate.
- La identidad del paquete es `meta.hash` del show; el nombre de fichero lleva los 8 primeros hex para distinguirlos a ojo.
- La RPi verifica `sha256` fichero a fichero y **salta los activos que ya tiene** (caché `assets/` por nombre, inmutable), así que reenviar un show con los mismos audios cuesta lo que pesa el JSON.
- Sigue existiendo la exportación del `show.json` suelto (copia de seguridad, inspección, `tools/show_to_legacy.py`).
- La especificación (esquema del manifest + ejemplo) vive en `rpi4-system/contract/bundle/`, junto al catálogo, y se copia al editor y a la app como se hace hoy con `catalog.json`.

### 2.2 Cómo llega a la RPi

| Vía | Cuándo | Cómo | Red necesaria |
|---|---|---|---|
| **A. Página web de la RPi** (principal) | Cualquier portátil o móvil junto al belén | En el local la RPi **emite su propia Wi-Fi `belen`** (contraseña en la etiqueta) con IP fija `10.42.0.1`; cualquier dispositivo se conecta y abre `http://belen.local:8080` o `http://10.42.0.1:8080`, teclea el PIN y arrastra el zip. En casa, para desarrollar, se une a las redes conocidas. La misma página da estado, play/stop y cortes por puerto | Solo la Wi-Fi de la RPi; **sin Internet** |
| **B. App móvil** (fase D) | Cambiar el show o cortar puertos desde el móvil | La app descarga los zips del backend cuando hay red y los guarda; junto al belén habla con la **misma API HTTP** de la RPi sobre el hotspot del propio móvil (el móvil conserva su 4G) | Wi-Fi local |
| **C. Bluetooth** (opcional) | Si la Wi-Fi resulta incómoda para el mando a distancia | Mismo protocolo sobre BLE para control y shows sin activos nuevos; nunca para el zip | Ninguna |

Por qué no se sube desde la página del editor: el editor se sirve por HTTPS desde Cloudflare y un navegador no deja llamar a `http://belen.local` desde una página HTTPS (contenido mixto y bloqueo de red privada). La página servida por la propia RPi no tiene ese problema porque es la RPi quien la sirve. El flujo queda en dos pasos (exportar zip en el editor, soltarlo en la página de la RPi) y funciona en Safari, Firefox, Chrome, Android e iPhone.

### 2.3 Varias personas y varios portátiles

- **Exportar**: cualquier miembro de la organización con rol OWNER, MANAGER o USER entra en el editor (desplegado en Workers) con su cuenta de Stocka y pulsa «Exportar paquet»; con la fase C también «Descargar paquete» en el frontend principal, sin abrir el editor. SPECTATOR puede descargar pero no editar.
- **Entregar**: la etiqueta de la caja es todo el manual: nombre de la Wi-Fi `belen`, su contraseña, la URL (`http://belen.local:8080` y `http://10.42.0.1:8080`) y el PIN. Un portátil que nunca ha visto la RPi se conecta a esa Wi-Fi y abre la URL; no hay nada que instalar ni configurar.
- **Nada depende del portátil de Joan**: el acceso SSH, el puerto reenviado desde Windows y el hotspot `HPMARTOOMEN` son comodidades de desarrollo, no parte del flujo. El propio servidor de la página es la única pieza que hay que mantener, y va en la RPi.
- **Concurrencia**: la importación es idempotente por hash y la activación es explícita, así que dos personas subiendo a la vez no se pisan; la página muestra el show activo, el anterior y quién activó qué (hora y nombre que escribe cada uno al entrar con el PIN).
- La página se sirve en catalán y castellano con un selector, sin depender de la cuenta de Stocka (no hay Internet para validarla).

## 3. Arquitectura objetivo

```
  Con Internet (casa, oficina)                              Sin Internet (local del belén)
  ┌─────────────────────────────────────────┐              ┌──────────────────────────────────────────────┐
  │ editor (Workers) → «Exportar paquet»    │   zip en     │ Portátil / móvil ── Wi-Fi local ──► RPi 4B    │
  │   show.json + audios vía BFF → .belen.zip│  disco/móvil │   http://belen.local:8080  (página + API)    │
  │                                                                                                        │
  │   show | bundle  (una sola implementación)│             │                                              │
  │ app (fase D): descarga y guarda bundles │              │ rpi4-system: api · bundle · PlayerCore ·     │
  └─────────────────────────────────────────┘              │   scheduler · overrides · modules (sin cambio)│
                                                           │ storage/ shows/<hash>/ · assets/ · active    │
                                                           └──────────────────────────────────────────────┘
```

Tres principios:

1. **Un paquete, varios orígenes.** `bundle.import_(path)` es el único camino de entrada; página y app lo usan igual.
2. **Un solo núcleo.** `PlayerCore` expone exactamente las operaciones de la API; la página y la app no tocan controladores.
3. **El hash es la identidad del show** y el nombre de activo es inmutable: lo que ya está en la RPi no se vuelve a copiar.

## 4. API HTTP de la RPi (`belen-api` v1)

Mantiene las rutas de la fase 2 del plan unificado y añade la importación de paquetes. Servidor `aiohttp` en el venv, puerto 8080, página estática en `/`.

| Método | Ruta | Función |
|---|---|---|
| GET | `/api/info` | Placa, versión, `deviceId`, show activo (hash, nombre), espacio libre, catálogo soportado, red actual (SSID, IP) |
| GET | `/api/status` | Estado, tiempo de ciclo, `mode`, overrides, último error; también por `GET /api/events` (SSE) |
| POST | `/api/bundles` | Sube un `.belen.zip` (multipart o cuerpo crudo). Respuesta: `{hash, ok, errors[], warnings[], skipped[], imported[]}` con los códigos de `contract/validate.py` |
| PUT | `/api/bundles/{hash}/parts` + `Content-Range` | Subida reanudable por trozos para móviles con Wi-Fi flojo (opcional en A, obligatorio en D) |
| GET | `/api/bundles` | Paquetes almacenados: hash, nombre, tamaño, fecha, activo/anterior |
| POST | `/api/bundles/{hash}/activate` | Atómico; el anterior pasa a `previous`; falla si falta algún activo |
| POST | `/api/rollback` | Vuelve a `previous` |
| DELETE | `/api/bundles/{hash}` | Borra (nunca el activo ni el anterior) |
| POST | `/api/play`, `/api/stop`, `/api/panic` | Mandos; `panic` = `SAFE` inmediato |
| GET/PUT | `/api/overrides` | Lista y fija cortes: `{target: "off" \| "normal"}`; `DELETE` limpia todos |
| POST | `/api/test/set`, `/api/test/release` | Modo prueba (fase 5) |
| GET | `/api/logs?n=` | Últimos registros |
| POST | `/api/net/mode` | Cambia entre `ap` (siempre Wi-Fi propia; el modo del local) y `auto` (redes conocidas, AP si no hay) |
| POST | `/api/system/reboot` | Reinicia la RPi (con PIN); para cuando no se puede llegar a la caja |
| POST | `/api/net/known` | Añade una red conocida (SSID + contraseña) con PIN; borra con `DELETE` |

La API escucha en `0.0.0.0:8080` desde el arranque, antes de que haya red y aunque el show activo falle al cargar (estado `SAFE`): la vía de comunicación nunca depende del show.

Seguridad proporcional al riesgo: el perímetro es la Wi-Fi (contraseña del hotspot o del AP). Las operaciones de lectura son libres; las de escritura exigen un **PIN de 6 cifras fijo**, guardado en `device.json` al instalar e impreso en una etiqueta dentro de la caja (la pantalla HDMI, si la hay, también lo muestra); cookie de sesión de 12 h; 5 fallos → 1 minuto de bloqueo. El PIN se cambia desde la página con el PIN actual o por SSH. Ningún puerto se expone a Internet aunque la RPi tenga red.

## 5. `rpi4-system` · reproductor (revisión de la fase 2)

### 5.1 Estructura

```
app/
  core/
    loader.py       # abre show.json, valida con contract.validate, construye la configuración de los controladores
    clock.py        # reloj de ciclo monotónico (posición del audio cuando hay audio: riesgo del plan unificado)
    scheduler.py    # tarea asyncio: dispara por reloj, nunca por espera acumulada; respeta overrides
    state.py        # BOOT → SAFE → IDLE ⇄ PLAYING ; TEST ; ERROR → SAFE
    overrides.py    # cortes por target, persistidos en storage/overrides.json
    core.py         # PlayerCore: la API que usan todos los orígenes
  bundle.py         # abre el zip, verifica manifest y sha256, importa a storage (único punto de entrada)
  storage.py        # shows/<hash>/show.json · assets/<kind>/<name> · incoming/ · active · previous · device.json
  api/
    server.py       # aiohttp: rutas de la sección 4, SSE, PIN, estáticos de ui/
    ui/             # página local: HTML + CSS + JS sin build (tokens del brandbook), arrastrar zip, estado, cortes
  net.py            # NetworkManager: redes conocidas → si no hay, hotspot belen-xxxx; expone SSID/IP para la pantalla
  screen.py         # pantalla HDMI: SSID, IP, URL, PIN, QR, show activo, estado (ventana Tk a pantalla completa)
  modules/          # controladores actuales + guardas de override (5.4)
contract/bundle/    # esquema del manifest y ejemplo
tools/              # show_hash.py, show_to_legacy.py (se mantiene para el core antiguo)
```

### 5.2 Modelo de ejecución

- `main.py` arranca un bucle **asyncio** en el hilo principal (lo comparten `aiohttp`, el scheduler y la pantalla). Los controladores conservan sus hilos; las llamadas bloqueantes van por `run_in_executor`. `PlayerCore` es el único que toca controladores.
- Estados y tabla de la fase 2 del plan unificado, sin cambios. En `PLAYING` solo se aceptan `stop`, `panic` y overrides.
- **Reloj**: `loop.call_at` sobre `time.monotonic()`; los atrasados se ejecutan en bloque; fin en `durationMs`, espera a procesos con tope de 300 s, y `mode` (`once`, `loop`, `pulse` con el pulsador).
- **Carga**: `loader.py` valida con `contract.validate.validate_package` (ya existe) y convierte `hardware` a lo que esperan los controladores. Primer paso: reutilizar `tools/show_to_legacy.convert` como puente; después, construcción directa.
- **Importación** (`bundle.py`): copia a `incoming/<hash>/`, verifica cada `sha256`, valida `show.json`, comprueba que todos los activos de `assets` están (en el zip o ya en caché), mueve con `os.replace` a `shows/<hash>/` y `assets/`, y responde el informe. Nunca deja medio paquete.
- **Activación atómica** y arranque como en el plan unificado: `SAFE` → `active`, si falla `previous`, si falla `SAFE` con la página disponible para corregir.

### 5.3 Red y pantalla

- `net.py` con dos modos en `device.json`: **`ap`** (el del local, por defecto una vez instalada): la RPi emite siempre la Wi-Fi `belen` con contraseña fija e IP fija `10.42.0.1` (`nmcli dev wifi hotspot` con `ipv4.addresses`), y el `dnsmasq` de NetworkManager responde a **cualquier** nombre con esa IP, así que escribir lo que sea en el navegador abre la página (el móvil o el portátil suelen mostrarla solos como «iniciar sesión en la red»). **`auto`** (casa y desarrollo): redes conocidas (hoy `HPMARTOOMEN` y `Realme`) y, si en 60 s no hay ninguna, el mismo AP. En `auto`, mientras está en AP sin clientes, cada 5 minutos vuelve a buscar redes conocidas; con un cliente conectado no cambia nunca. Cambio de modo desde la página con PIN (`POST /api/net/mode`) y por pulsación larga (5.5). `avahi` anuncia `belen.local` (el hostname pasa a `belen`), y la etiqueta lleva también la IP porque Android no siempre resuelve `.local`.
- `screen.py`: ventana a pantalla completa en el escritorio existente (`DISPLAY=:0`, ya lo usa el servicio): nombre, SSID e IP, URL, PIN, QR de la URL, show activo y estado. Es lo que se mira al llegar al local.

### 5.4 Cortar un puerto (`overrides`)

Se impone en tres puntos para que una salida cortada no pueda encenderse:

1. `scheduler.py` no despacha eventos cuyo `target` esté cortado.
2. `PlayerCore.set_override(target, "off")` para en el acto lo que ese target tenga en marcha: relés `stop(name)` + `turn_off`; LEDs `_stop_animation(name)` + `clear(name)`; motor `stop()`; audio/vídeo `stop()`.
3. Guardas en los puntos de escritura: `set_gpio` (relés, motor) y `_set_pixel_color`/`fill` (LEDs) consultan el conjunto de pines y segmentos cortados. Audio y vídeo no tienen identidad por puerto: el corte es por controlador.

Los overrides se guardan en `storage/overrides.json`, **sobreviven al reinicio** (recomendación; ver decisiones) y la página y `status` los muestran siempre.

### 5.5 Arranque desatendido (requisito: poco acceso físico tras la instalación)

Cada encendido tiene que terminar, sin intervención, con la RPi alcanzable por la red local y lista para importar. Para ello:

- **Servicio systemd `belen.service`** habilitado (sustituye al `@reboot` del crontab y al listener de teclado de `autostart_manager.py`, que desaparece): `Restart=always`, `RestartSec=5`, `WatchdogSec=60` con `sd_notify` desde el bucle principal, `After=network.target` pero **sin esperar** a la red ni a la sesión gráfica. Se habilita en A2 y se acepta en A5; hasta entonces el autoarranque sigue desactivado.
- **Orden de arranque del proceso**: salidas a seguro → API escuchando → carga del show activo (si falla, `previous`; si falla, `SAFE`) → red (`net.py`) → pantalla si hay `DISPLAY`. Un fallo en cualquier paso posterior a la API no la tumba.
- **Red garantizada**: en modo `ap` la Wi-Fi `belen` está arriba a los pocos segundos del arranque; en modo `auto`, red conocida o AP a los 60 s. En ambos casos la RPi es alcanzable en menos de 90 s desde el encendido por cualquier dispositivo con la contraseña de la etiqueta. SSH queda habilitado por la misma red (`ssh joa@belen.local`) para mantenimiento sin tocar la caja.
- **Identidad fija, sin pantalla**: `belen.local`, SSID `belen`, contraseña del AP y PIN viven en `device.json` desde la instalación y van impresos en una etiqueta. La pantalla HDMI es una ayuda, no un requisito: `screen.py` se salta si no hay display.
- **Pulsador físico** (ya existe, `Pulsador`): pulsación larga de 10 s fuerza el AP de rescate; de 30 s, `panic` a `SAFE`. Es la única interacción física prevista.
- **Recuperación sin acceso**: `previous` desde la página; `systemd` reinicia el proceso si cae; reinicio de la RPi desde la página (`POST /api/system/reboot` con PIN). Registros en `journald` con rotación y descargables desde la página.
- **Cortes de corriente**: escrituras mínimas y atómicas (`storage.py`); `fsck` automático en el arranque; raíz de solo lectura con partición de datos se valora en la fase 5.

### 5.6 Tests y banco

- Unitarios sin hardware: `bundle.py` (manifest, sha256 malo, activo que falta, zip a medias, activos ya en caché), `storage.py` (atomicidad, rollback), `scheduler.py` con reloj falso, `state.py`, `overrides.py`, `loader.py` con `contract/samples/belen-2026.show.json`, `api/server.py` con el cliente de pruebas de `aiohttp` (PIN, subida, informe).
- **Equivalencia**: el `2026.json` actual convertido a v2 produce la misma secuencia de llamadas a controladores que el core antiguo.
- Modo simulado completo (`--simulate`): relés, motor y audio escriben a log como ya hace `ws281x_mock.py`; sirve en el portátil y en la Pi.
- En la Pi real por `ssh rpi4b`: despliegue con `git pull`, arranque en `--simulate`, subir un zip desde Chrome y desde el móvil, 20 pases. **Arranque desatendido**: 10 encendidos en frío sin teclado ni pantalla, con el hotspot presente y sin él; en todos la página responde en menos de 90 s. Reactivar el autoarranque solo al aceptar la fase A.

## 6. `timeline-editor` · «Exportar paquet»

- `app/utils/bundle/`: `manifest.ts` (tipos y construcción), `buildBundle.ts` (recibe el `ShowPackage` de `buildShowPackage`, pide los bytes de cada `meta.assets[].attachmentId` al BFF (`catalog.attachmentContentUrl`), calcula `sha256` con WebCrypto, arma el zip con **`fflate`** (pequeña, en streaming, sin dependencias) y devuelve un `Blob`), `fileName.ts` (`<nombre>-<hash8>.belen.zip`). `audioCache.ts` no sirve porque solo guarda el audio decodificado.
- `Toolbar.vue`: botón **«Exportar paquet»** junto a «Exportar show» (que se mantiene); diálogo de progreso por fichero (modal con `Teleport` como `ImageLightbox.vue`, tokens de `main.css`, textos en catalán) y, al acabar, descarga y una nota: «Obre `http://belen.local:8080` connectat a la Wi-Fi del pessebre i arrossega-hi el fitxer».
- Errores de `buildShowPackage` bloquean (como hoy); avisos se muestran con `ExportIssues`.
- Tests vitest en `app/utils/__tests__/bundle/`: manifest, nombres, zip con `fetch` falso y comprobación de que la RPi lo acepta (fixture compartida con `rpi4-system/tests` a través de `contract/bundle/`).
- No se necesita BFF nuevo ni backend nuevo para la fase A.

## 7. `backend`

### Fase A

Nada obligatorio. Dos cosas pequeñas y útiles: Bruno con la secuencia «exportar → zip», y el test de `PieceAttachmentController` de que `/content` sirve `Content-Length` (lo usa la barra de progreso).

### Fase C · paquete en el servidor (lo necesita la app)

- `GET /organizations/{orgSlug}/timelines/{id}/show` devuelve el `show.json` v2 generado en Java sobre `SceneDocument`, `JpaSceneContext`, `OutputCatalog` y `SceneValidator`, más las reglas de paquete de `contract/validate.py` y el JSON canónico. **Test de oro**: para la escena de `belen-2026` el hash debe ser `sha256:6e46887d…`, el mismo que producen el editor y `tools/show_hash.py`.
- `GET /organizations/{orgSlug}/timelines/{id}/bundle` devuelve el `.belen.zip` en streaming (JSON + activos leídos de R2 con `R2Service.open`), roles OWNER, MANAGER y USER. Es lo que descarga la app y lo que permite un botón «Descargar paquete» en el frontend principal sin pasar por el editor.
- Al estar, el editor puede usar el paquete del servidor (una sola implementación) y el MCP gana `timeline_show_export`.

### Fase B · dispositivos (opcional, baja prioridad ahora)

Tabla `devices` (V24) y página Dispositivos en el frontend solo si se quiere ver en Stocka qué show tiene cada belén. La RPi, cuando tenga Internet, enviaría un latido (`POST /player/devices/{deviceId}/heartbeat` firmado) con estado y hash activo. No condiciona nada de lo anterior.

## 8. App móvil (fase D)

- **Stack recomendado: Capacitor + Vue** (Vite, sin SSR) en un repo nuevo `belen-app`: reutiliza el módulo `bundle/` y los componentes del panel; en Android se permite HTTP en claro hacia la red local (`android:usesCleartextTraffic`) y en iOS la excepción equivalente (`NSAllowsLocalNetworking`). Alternativas: Expo/React Native o Flutter, que obligan a reescribir.
- Funciones: login en Stocka (`/auth/login` + refresh, 2FA incluido); organizaciones → timelines; **«Descargar»** guarda el `.belen.zip` de la fase C en el móvil (funciona después sin red); junto al belén, el móvil enciende su hotspot (la RPi ya conoce `Realme`) o se conecta al AP de la RPi, la app descubre `belen.local` (o se escribe la IP de la pantalla) y usa la API de la sección 4: **subir paquete** (reanudable), activar, play/stop/panic, **cortes por puerto** en vivo, logs.
- Orden: D1 esqueleto + login + conexión y estado; D2 cortes y mandos; D3 descargar y cargar timelines. Android primero (APK interno); iOS después.
- Si el cambio de red del móvil resulta molesto, el **apéndice BLE** cubre el mando (cortes, play/stop) sin tocar la Wi-Fi.

## 9. Orden de trabajo y calendario

El punto de corte del plan unificado (1 de noviembre: el belén reproduce un show del editor) se mantiene con A1–A3. Las fases 4 (banco) y 5 (robustez) siguen igual.

| Fase | Fechas | Repo | Entregable |
|---|---|---|---|
| **A1** | 19–25 oct | `rpi4-system` | `contract/bundle/`, `bundle.py`, `storage.py`, `loader.py`, `scheduler.py`, `state.py`, `overrides.py`, `PlayerCore`, `--simulate`; tests; equivalencia con `2026.json` |
| **A2** | 26–29 oct | `rpi4-system` | `api/server.py` + `ui/`, `net.py` (modos `ap`/`auto`, IP fija, DNS que redirige a la página), `screen.py` opcional, `belen.service` con watchdog, pulsación larga del pulsador; prueba en la Pi real desde Chrome y Safari del móvil, y 10 reinicios en frío |
| **A3** | 28 oct – 1 nov | `timeline-editor` | `bundle/` con `fflate`, «Exportar paquet», diálogo de progreso; tests; zip real importado por la Pi |
| **A4** | 2–5 nov | Pi | Subida reanudable, borrado de paquetes, `net/hotspot`, pulido de la página (cortes, logs) |
| **A5** | 6–8 nov | Pi | Banco: 20 pases, cortes de corriente, importaciones repetidas, reinicios sin acceso; reactivar autoarranque (`belen.service`) y pegar la etiqueta con URL, SSID, contraseña y PIN |
| **C** | 9–22 nov | `backend` + editor + frontend | `GET …/show` con test de oro, `GET …/bundle`, botón «Descargar paquete» en el frontend, herramienta MCP |
| **B** | si sobra tiempo | `backend` + `frontend` | `devices` y latido |
| **D** | después de Navidad (o diciembre si A y C acaban antes) | `belen-app` | App Android (D1–D3); iOS después |

Si el calendario aprieta: A4 se reduce a lo imprescindible (sin reanudación) y C pasa a después de Navidad. A1–A3 y A5 no se recortan.

## 10. Riesgos

| Riesgo | Mitigación |
|---|---|
| Android o Windows abandonan una Wi-Fi sin Internet (el AP de la RPi) para volver a otra | Vía principal: la RPi se une al **hotspot del móvil o del portátil**, que conservan su Internet; el AP propio es el plan B. En Android, «mantener esta red» una vez |
| El hotspot del móvil cambia de nombre o contraseña | La página de la RPi permite añadir una red (SSID + contraseña) con el PIN; también `nmcli` por SSH |
| Contenido mixto: el editor no puede hablar con la RPi | Asumido por diseño: dos pasos (exportar zip, soltarlo en la página de la RPi). El zip en disco es además la copia de seguridad |
| Reescribir el núcleo rompe lo que funcionaba | Test de equivalencia y modo simulado; el core viejo y `show_to_legacy.py` se mantienen hasta aceptar A5 |
| Zip grande y Wi-Fi floja | Subida reanudable (A4) y activos que ya están se saltan |
| Tarjeta SD corrupta por cortes de corriente | Escrituras mínimas y atómicas; `active`/`previous`; valorar raíz de solo lectura (fase 5) |
| PIN a la vista en la pantalla | El perímetro real es la contraseña Wi-Fi; el PIN evita toques accidentales; se regenera cuando se quiera |
| Hilos de controladores contra el bucle asyncio | `PlayerCore` único punto de entrada; bloqueantes al executor; los controladores no cambian |
| El flujo depende de algo que solo tiene Joan (SSH, portproxy, hotspot conocido) | Por diseño no: Wi-Fi propia con contraseña en la etiqueta, página servida por la RPi, cuenta de Stocka de cada miembro; SSH es solo mantenimiento |
| Sin acceso físico, una red mal configurada o un fallo del software dejan la RPi inalcanzable | AP de rescate automático a los 60 s; pulsación larga del pulsador; `systemd` con `Restart=always` y watchdog; API arriba aunque el show falle; SSH por la misma red; reinicio desde la página |

## 11. Decisiones tomadas (19 de octubre de 2026)

1. **Modo de red**: `ap` siempre en el local (la RPi emite la Wi-Fi `belen`); `auto` solo en casa para desarrollar.
2. **PIN fijo de seis cifras** para las operaciones de escritura, impreso en la etiqueta; cambiable desde la página con el PIN actual.
3. **Overrides persistentes** tras el reinicio; la página los muestra siempre en grande.
4. **Bluetooth aplazado**: se decide al terminar D2 con la app en la mano.
5. **App móvil con Capacitor + Vue**; Android primero.
6. **Identidad fija impresa**: SSID `belen`, contraseña del AP y PIN se fijan al instalar y van en la etiqueta dentro de la caja.
7. **Pulsación larga del pulsador**: 10 s fuerza la Wi-Fi propia, 30 s `panic`. Única interacción física prevista.

## 12. Criterios de aceptación

- **A**: en casa, con Internet, «Exportar paquet» en el editor deja un `.belen.zip` con show y audios. En el local, sin Internet: el dispositivo se conecta a la Wi-Fi `belen` (o, en modo `auto`, el móvil enciende el hotspot y la RPi se une), la etiqueta o la pantalla dan URL y PIN, se arrastra el zip desde el navegador del móvil o del portátil, la RPi informa en menos de 10 s para un zip de 20 MB, se activa y se pulsa `play`. **Desde un portátil que nunca ha visto la RPi y con la cuenta de otro miembro**: exportar el paquete en el editor, conectarse a la Wi-Fi `belen` con la contraseña de la etiqueta, abrir la URL de la etiqueta, PIN, soltar el zip, activar. Cortar un puerto desde la página apaga la salida en menos de 1 s y el evento siguiente no la enciende. Tras apagar y encender la Pi, todo sigue igual. **10 encendidos en frío sin teclado ni pantalla, con y sin el hotspot presente: la página responde en menos de 90 s por la red conocida o por el AP de rescate.** 20 pases seguidos sin desfase apreciable.
- **C**: `GET …/show` produce el mismo hash que el editor para el show de 2026; `GET …/bundle` se importa en la Pi sin cambios.
- **D**: la app Android descarga paquetes con red, y sin red los sube a la Pi, corta puertos y cambia el show.

## Apéndice · Bluetooth como opción

Si más adelante se quiere mando desde el móvil sin tocar la Wi-Fi: servicio BLE GATT en la RPi (`bluez-peripheral`, probado que instala en su Python 3.13) con el **mismo vocabulario de la API** (estado, play/stop/panic, overrides, `show.json` sin activos nuevos), UUID de servicio `b4b87358-4738-42cf-b803-9f892007aac1` y características `Info` (`be0b6e15-…`), `Control` (`c8517845-…`), `Events` (`655aa88b-…`) y `Transfer` (`38b78dc7-…`), encuadre de fragmentos y autenticación por desafío-respuesta con el secreto del dispositivo. Nunca para el zip: a 5–20 KB/s un audio de 4 MB tarda minutos. Desde el navegador solo en Chromium (Web Bluetooth); desde la app, BLE nativo. Se decide al terminar D2.
