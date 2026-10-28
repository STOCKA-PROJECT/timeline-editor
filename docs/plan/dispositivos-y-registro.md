# Panel del dispositivo en Stocka y registro (logs) en el backend

**Plan del 26 de octubre de 2026.** Dos cosas en la sección «Dispositius» del frontend: seleccionar un dispositivo
y tener **las mismas opciones que la app móvil** (estado, mandos, puertos con sus piezas y pruebas, paquetes, red,
sistema), y un **apartado grande con el registro** del dispositivo, guardado en el backend para consultarlo y
descargarlo aunque la Raspberry esté apagada.

## Decisiones (Joan, 26-10)

| # | Pregunta | Decisión |
|---|---|---|
| 1 | Quién sube el registro al backend | **La Pi sola** cuando tiene Internet (con su token de latido) y **la app móvil de mensajera** cuando la Pi no tiene: la app lee lo nuevo de la Pi en el belén, lo guarda en el móvil y lo sube cuando vuelve a tener Internet. El frontend **solo lee** del backend |
| 2 | Alcance del control desde el frontend | **Solo en la misma red** que la Pi, como la app: el navegador habla directamente con la Pi. Sin control a distancia |
| 3 | Retención en el backend | **180 días** (`stocka.devices.logs.retention`, `DEVICE_LOGS_RETENTION`), luego se borra solo |

## Límites del navegador (no son del diseño)

- El frontend se sirve por HTTPS y la Pi responde por HTTP en la red local. Solo **Chrome y Edge** (escritorio y
  Android) lo permiten, con el permiso de «acceso a la red local» y la pista `targetAddressSpace: 'local'`, igual que
  el editor (`utils/pi/piClient.ts`). Safari y Firefox lo bloquean: el panel lo dice y deja el resto de la página
  (registro incluido) funcionando.
- La Pi solo responde CORS a los orígenes de `CORS_ORIGINS`: se añade el del frontend
  (`https://stocka.joanmartorellcoll03.workers.dev`).
- El frontend no funciona sin Internet: el panel sirve en el taller, en casa o en un belén con Wi-Fi con Internet.
  Con la Pi en «Wi-Fi propia» se usan la app o el editor instalado.

## 1. Registro: formato y sincronización

La Pi escribe un fichero por día, `storage/logs/system-AAAA-MM-DD.log`, con líneas
`2026-10-26 18:30:02 | Controlador | NIVEL    | mensaje`. El deduplicador reescribe la **fecha** de la última línea
cuando un mensaje se repite, sin cambiar su longitud: la posición en bytes de lo ya escrito no cambia, así que se
sincroniza **por fichero y desplazamiento**. Se sube en trozos que acaban en salto de línea.

### Pi (`rpi4-system`)

- `GET /api/logs/files` → `{files: [{name, size, modifiedAt}]}`: los ficheros diarios (`*.log`).
- `GET /api/logs/files/{name}?from=&max=` → `text/plain`: los bytes desde `from` hasta el último salto de línea
  dentro de `max` (1 MiB por defecto); cabeceras `X-Log-From`, `X-Log-To` (exclusivo) y `X-Log-Size`. Lectura
  pública como el resto de lecturas; el nombre no admite rutas.
- `app/logsync.py`: con `heartbeatUrl` y `heartbeatToken` configurados, cada 5 minutos (y poco después de arrancar)
  pide al backend hasta dónde tiene cada fichero y le manda lo que falta, como mucho unos MB por vuelta. Los fallos
  solo se registran: sin Internet no pasa nada y lo pendiente se queda en la Pi.

### Backend

- Tabla `device_log_chunks` (V31): dispositivo, fichero, día, desplazamiento inicial y final, líneas, primera y
  última hora, clave de R2, bytes guardados, origen (`DEVICE` o `USER`), quién lo subió. Único
  `(device_id, file_name, start_offset)`. El texto va **comprimido en R2**
  (`device-logs/<deviceId>/<fichero>/<desde>-<hasta>.log.gz`), no en la base de datos: unos MB por día y
  dispositivo engordarían las copias de seguridad.
- Subir un trozo es idempotente: lo que ya está se recorta, un trozo que deja un hueco devuelve
  `409 devices.log_offset_mismatch` con el final que tiene el backend.
- Endpoints:
  - `GET /player/logs/cursor` y `POST /player/logs` con `Authorization: Device <token>` (la Pi).
  - `GET /devices/{uuid}/logs/cursor` y `POST /devices/{uuid}/logs` con la sesión del usuario (la app de
    mensajera): el dispositivo se busca por el uuid que la Pi se genera, entre las organizaciones donde el usuario
    puede controlar dispositivos.
  - `GET /organizations/{org}/devices/{id}/logs` (días guardados), `GET …/logs/{fichero}?tail=` (texto del día o
    sus últimas líneas, `?download=1` como adjunto) y `GET …/logs/archive?from=&to=` (zip de varios días).
- Limpieza diaria de lo que pasa de la retención.

### App móvil (mensajera)

Al conectar con la Pi y cada pocos minutos mientras sigue conectada: pide la lista de ficheros, lee lo que no tiene
y lo guarda en el móvil (cola con tope de tamaño). Cuando hay Internet y sesión de Stocka, pide al backend su cursor
(lo que ya subió la Pi no se repite) y vacía la cola.

## 2. Panel del dispositivo en el frontend

`/dashboard/{org}/dispositivos/{id}`: la fila de la lista abre la página del dispositivo. La dirección local y el
PIN ya están en Stocka (V30): se conecta sola.

Bloques, los mismos que la app: estado y alertas; Reproduce / Para / Todo en seguro; puertos con sus piezas, corte y
pruebas (relé, color en vivo, motor mientras se mantiene pulsado, sonido); sensores; **enviar un show** (se elige una
timeline, el backend genera el `.belen.zip` con `GET …/timelines/{id}/bundle` y el frontend lo sube a la Pi por
trozos); paquetes de la Pi (activar, volver al anterior, borrar); red; reiniciar. Los espectadores solo ven el
estado.

**Registro**: apartado grande con el día, filtros de nivel (INFO / WARNING / ERROR) y de controlador, búsqueda,
«Descarrega el dia» y «Descarrega un període», y la hora de la última subida. Lee del backend, así que funciona
aunque la Pi esté apagada.

El cliente de la Pi del frontend sale del de la app (`belen-app/src/api/pi.ts`, el más completo) con la pista de
red local del editor; es una tercera copia, como el catálogo.

## 3. Estado (27-10)

Hecho y probado: backend (V31, `DeviceLogService`, endpoints, limpieza, pruebas y Bruno), Pi (`app/logfiles.py`,
`app/logsync.py`, endpoints de lectura, origen del frontend en CORS), frontend (página del dispositivo con el panel y el
registro) y app (mensajera, `stores/logRelay.ts`). Probado de punta a punta en local con una Pi simulada: el panel lee
el estado, enciende un relé, cambia un LED en vivo y gira un motor mientras se mantiene pulsado; la mensajera sube
10 MB de registro en trozos de 1 MiB y el visor los muestra.

La CSP del frontend (`connect-src`) no dejaba hablar con la Pi: Joan decidió (27-10) que el control desde el ordenador
sea solo Stocka web y se abrió solo `http://*:8080` en `nuxt.config.ts` (cualquier host de la red local, HTTP, puerto
del reproductor). Un dispositivo guardado con otro puerto o con https muestra un aviso en su página.

## 4. Pendiente (Joan, 27-10: «ho farem més tard»)

1. ~~Provar «Envia un show»~~ **Fet (28-10)**: el client real del frontend (`uploadBundle`) va enviar un paquet de 3 MiB en trossos d'1 MiB a una Pi simulada, importat i activat; la branca 422 (escena amb errors) també surt bé.
2. ~~Provar la CSP nova~~ **Fet (28-10)**: amb la capçalera real, la pàgina connecta a una Pi al port 8080 sense cap violació; a un altre port no ho intenta i mostra l'avís.
3. ~~Commits als 5 repos~~ **Fet (28-10)**; `storage/configs/2026.json` (només reindentació) s'ha deixat fora.
4. ~~Desplegar~~ **Fet (28-10)**: Pi a `d9e9ee3` amb el servei engegat (autoarrencada igual que abans, desactivada), backend amb V31
   a producció (còpia de seguretat prèvia), editor i frontend construïts per Cloudflare (la primera build del frontend va
   fallar sense registre; un commit buit la va rellançar i va passar), app pujada a GitHub (l'APK es compila a mà).
   Pendent d'enllaçar la Pi amb Stocka des de la seva pàgina perquè el `logSync` i el latido funcionin, i reexportar
   la timeline perquè els ports portin les peces.
5. ~~App: dispositius de Stocka~~ **Fet (27-10)**: `stores/devices.ts` baixa els dispositius de totes les organitzacions
   amb sessió i Internet, els desa a Preferences, la pestanya «Pessebre» els mostra i un toc posa adreça i PIN i connecta;
   en obrir la pestanya sense connexió es proven després de l'última adreça bona. Era: fer servir els dispositius desats a Stocka, **com a mínim per autocompletar les dades de la connexió**
   (avui només coneix `belen.local`, `10.42.0.1`, l'última adreça que va funcionar i un PIN escrit a mà, d'una sola
   Pi). Llegir `GET /organizations/{org}/devices` amb la sessió (i guardar-ho per quan no hi hagi Internet al pessebre)
   i omplir l'adreça i el PIN amb la `localUrl` i el `pin` de cada un; si es pot, connectar amb un toc, com fa l'editor
   des de la V30.
6. Detalls: al frontend, el selector de color no mostra el color que ja té un LED en prova després de recarregar;
   l'app no adopta les proves que ja estaven enceses en connectar (el frontend sí).
7. Frontend: ESLint no funciona (ja passava abans) i hi ha 4 errors de tipus en fitxers no tocats (`app.vue`,
   `SecurityActivitySection.vue`, `DevicesBoard.vue`, `TimelinesBoard.vue`).

Revisió de codi (28-10, abans del commit): sense errors de correcció. Tres coses arreglades: els fitxers diaris de la Pi
ja no roten per mida (una rotació a `.log.1` hauria deixat la resta del dia sense pujar), l'app no es queda encallada si
perd un tros del registre al mòbil (el tracta com un forat i torna a llegir), i «última pujada» només compta pujades amb
bytes nous. Queden anotats com a menors: el bloqueig de la fila del dispositiu dura el que dura la pujada a R2 (segons; un
latido del mateix dispositiu espera), un objecte absent a R2 surt com a cos truncat en lloc d'error, i el trosseig pot
tallar una línia quan el pressupost de la volta s'acaba (només afecta el recompte de línies).

## 5. Orden

1. Backend: tabla, R2, endpoints, limpieza, pruebas, colección de Bruno.
2. Pi: lectura por trozos, subida propia, origen del frontend en CORS. Se despliega antes que nada que dependa de
   ella.
3. Frontend: página del dispositivo con el panel y el registro.
4. App: mensajera.
