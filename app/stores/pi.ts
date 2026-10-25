import { defineStore } from 'pinia'
import type { ShowAssetRef, ShowPackage } from '~/types/show'
import { DEFAULT_PI_URLS, normalizePiUrl, PiApiError, PiClient, type PiInfo, type PiStatus, type UploadProgress } from '~/utils/pi/piClient'
import { rehearseOnPi, type RehearsalRange, type RehearseResult } from '~/utils/pi/rehearse'
import { sendShowToPi, type SendPhase, type SendShowResult } from '~/utils/pi/sendShow'

const URL_KEY = 'stocka.pi.url'
/** How often the log is refreshed while the panel shows it. */
export const PI_LOG_POLL_MS = 2000
export const PI_LOG_LINES = 300

function readStorage(storage: 'local' | 'session', key: string): string | null {
  try {
    return (storage === 'local' ? localStorage : sessionStorage).getItem(key)
  } catch {
    return null
  }
}

function writeStorage(storage: 'local' | 'session', key: string, value: string | null) {
  try {
    const s = storage === 'local' ? localStorage : sessionStorage
    if (value === null) s.removeItem(key)
    else s.setItem(key, value)
  } catch {
    // private mode: the value lives only in memory
  }
}

function message(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

/**
 * The belén Raspberry Pi the editor is connected to (one at a time; `useDevicesStore` lists all of
 * them): where it is on the local network, its PIN for commands, its live status, its log, and sending
 * the open show to it. Works without Internet: only the laptop and the Pi on the same network. When
 * the Pi is a device saved in Stocka (`entry`) its saved PIN is used, and a PIN the Pi accepts or the
 * address of a device that had none are saved back.
 */
export const usePiStore = defineStore('pi', () => {
  const url = ref<string>(readStorage('local', URL_KEY) ?? DEFAULT_PI_URLS[0])
  const devices = useDevicesStore()
  /** PIN of the connected device. */
  const pin = ref<string | null>(null)
  /** Stocka id of the saved device the connected Pi is, if any. */
  const entryId = ref<number | null>(null)
  const pinVerified = ref(false)
  const info = ref<PiInfo | null>(null)
  const status = ref<PiStatus | null>(null)
  /** `performance.now()` when the last status arrived: the playhead interpolates from it. */
  const statusAt = ref(0)
  watch(status, () => { statusAt.value = typeof performance === 'undefined' ? Date.now() : performance.now() }, { flush: 'sync' })
  /** Bumped when something outside the toolbar needs the «Dispositiu» panel open (connect, PIN). */
  const panelRequests = ref(0)
  const connecting = ref(false)
  /** The live stream is delivering (false while it reconnects). */
  const streaming = ref(false)
  const error = ref<string | null>(null)
  const logs = ref<string[]>([])
  const logError = ref<string | null>(null)
  const busyCommand = ref<string | null>(null)

  const sendPhase = ref<SendPhase | 'done' | 'error' | null>(null)
  const sendProgress = ref<UploadProgress | null>(null)
  const sendResult = ref<SendShowResult | null>(null)
  const sendError = ref<string | null>(null)

  let client: PiClient | null = null
  let stopWatch: (() => void) | null = null
  let logTimer: ReturnType<typeof setInterval> | null = null

  const connected = computed(() => info.value !== null)
  /** The saved device the connected Pi is (null for a Pi that is not in the organization). */
  const entry = computed(() => (entryId.value === null ? null : devices.entryOf(entryId.value)))
  const alerts = computed(() => status.value?.alerts ?? [])
  const lockedMotors = computed(() => Object.entries(status.value?.motors ?? {}).filter(([, m]) => m.locked).map(([name]) => name))
  const state = computed(() => status.value?.state ?? info.value?.state ?? null)
  const sending = computed(() => sendPhase.value !== null && sendPhase.value !== 'done' && sendPhase.value !== 'error')
  const rehearsal = computed(() => status.value?.rehearsal ?? null)

  function actorName(): string {
    const user = useAuthStore().user
    return [user?.name, user?.lastName].filter(Boolean).join(' ') || user?.email || 'editor'
  }

  function newClient(address: string): PiClient {
    return new PiClient(address, { name: actorName() })
  }

  function disconnect() {
    stopWatch?.()
    stopWatch = null
    stopLogs()
    client = null
    info.value = null
    entryId.value = null
    status.value = null
    streaming.value = false
  }

  /** Works out which saved device the connected Pi is (after connecting or saving it to Stocka). */
  function relink() {
    if (!info.value) return
    const match = devices.match(info.value, url.value)
    entryId.value = match?.id ?? null
    if (match) devices.noteAnswer(match, info.value)
  }

  /** The Pi has no battery clock: when its time is not reliable, give it ours (an old Pi without the endpoint is fine). */
  async function syncClock(c: PiClient) {
    if (!status.value?.clock || status.value.clock.reliable) return
    try {
      await c.syncClock()
      if (client === c) status.value = await c.status()
    } catch {
      // without the time the Pi ignores the schedule and the button keeps working
    }
  }

  /** Connects to `address` (or the saved one); on success it is remembered for next time. */
  async function connect(address?: string): Promise<boolean> {
    connecting.value = true
    error.value = null
    try {
      const target = normalizePiUrl(address ?? url.value)
      const c = newClient(target)
      const i = await c.info()
      disconnect()
      client = c
      info.value = i
      url.value = c.baseUrl
      writeStorage('local', URL_KEY, c.baseUrl)
      relink()
      // A saved device without address learns the one it answered at.
      if (entry.value && !entry.value.url) void devices.saveConnection(entry.value.id, { localUrl: c.baseUrl })
      pin.value = devices.pinFor(entry.value)
      c.pin = pin.value
      pinVerified.value = false
      status.value = await c.status().catch(() => null)
      stopWatch = c.watch((s) => {
        status.value = s
        streaming.value = true
      }, () => {
        streaming.value = false
      })
      if (pin.value) pinVerified.value = await c.checkPin(pin.value).catch(() => false)
      void syncClock(c)
      return true
    } catch (e) {
      error.value = message(e, 'No s’ha pogut connectar amb la Raspberry.')
      return false
    } finally {
      connecting.value = false
    }
  }

  /** Tries the last address, the ones saved in Stocka, then the usual ones (`belen.local`, the Pi's own Wi-Fi). */
  async function autoConnect(): Promise<boolean> {
    const saved = devices.entries.map(e => e.url).filter((u): u is string => !!u)
    const candidates = [...new Set([url.value, ...saved, ...DEFAULT_PI_URLS])]
    for (const candidate of candidates) {
      if (await connect(candidate)) return true
    }
    return false
  }

  /** Checks the PIN on the Pi and keeps it for this browser session. */
  async function setPin(value: string): Promise<boolean> {
    error.value = null
    const trimmed = value.trim()
    if (!client) {
      error.value = 'Connecta’t primer a la Raspberry.'
      return false
    }
    try {
      const ok = await client.checkPin(trimmed)
      if (!ok) {
        error.value = 'PIN incorrecte.'
        pinVerified.value = false
        return false
      }
      pin.value = trimmed
      client.pin = trimmed
      pinVerified.value = true
      if (entry.value) void devices.rememberPin(entry.value, trimmed)
      return true
    } catch (e) {
      error.value = message(e, 'No s’ha pogut comprovar el PIN.')
      return false
    }
  }

  /** Asks for the PIN again (the new one replaces the saved one once the Pi accepts it). */
  function forgetPin() {
    pin.value = null
    pinVerified.value = false
    if (client) client.pin = null
    if (entry.value) devices.forgetSessionPin(entry.value)
  }

  /** Saves the address the Pi answers at now on its device in Stocka. */
  async function saveAddress() {
    if (!entry.value || !client) return null
    return await devices.saveConnection(entry.value.id, { localUrl: client.baseUrl })
  }

  /**
   * Saves the connected Pi in Stocka: as the saved device `id` (one no Pi had claimed) or, with
   * `id` null, as a new device named like the Pi. A new device also gets the heartbeat set up on the
   * Pi when the PIN is known. Returns a line for the panel, or null when it failed (see
   * `devices.saveError`).
   */
  async function saveToStocka(id: number | null): Promise<string | null> {
    if (!client || !info.value) return null
    const change = {
      localUrl: client.baseUrl,
      deviceId: info.value.device.deviceId,
      ...(pinVerified.value && pin.value ? { pin: pin.value } : {})
    }
    if (id !== null) {
      const outcome = await devices.saveConnection(id, change)
      if (outcome === 'failed') return null
      relink()
      return outcome === 'queued' ? 'Es desarà a Stocka quan hi hagi connexió.' : 'Desada a Stocka.'
    }
    const created = await devices.register(info.value.device.name, change)
    if (!created) return null
    relink()
    if (!pinVerified.value) return 'Afegida a Stocka. Per veure-la en línia al tauler, posa el PIN i torna-ho a provar, o rota’n el token des de Stocka.'
    try {
      await client.configureHeartbeat(created.heartbeatUrl, created.heartbeatToken)
      return 'Afegida a Stocka; quan tingui Internet hi enviarà el seu estat.'
    } catch {
      return 'Afegida a Stocka, però la Raspberry no ha acceptat la configuració del batec: rota’n el token des de Stocka.'
    }
  }

  async function refreshLogs() {
    if (!client) return
    try {
      logs.value = await client.logs(PI_LOG_LINES)
      logError.value = null
    } catch (e) {
      logError.value = message(e, 'No s’ha pogut llegir el registre.')
    }
  }

  function startLogs() {
    stopLogs()
    void refreshLogs()
    logTimer = setInterval(() => void refreshLogs(), PI_LOG_POLL_MS)
  }

  function stopLogs() {
    if (logTimer) clearInterval(logTimer)
    logTimer = null
  }

  async function command(name: string, run: (c: PiClient) => Promise<unknown>) {
    if (!client) return
    busyCommand.value = name
    error.value = null
    try {
      const result = await run(client)
      if (result && typeof result === 'object' && 'state' in result) status.value = result as PiStatus
    } catch (e) {
      if (e instanceof PiApiError && (e.code === 'pin_invalid' || e.code === 'pin_required')) pinVerified.value = false
      error.value = message(e, 'La Raspberry no ha acceptat l’ordre.')
    } finally {
      busyCommand.value = null
    }
  }

  const play = () => command('play', c => c.play())
  const stop = () => command('stop', c => c.stop())
  const panic = () => command('panic', c => c.panic())
  const clearAlerts = () => command('alerts', c => c.clearAlerts())
  const unlockMotor = (motor: string) => command(`unlock:${motor}`, c => c.unlockMotor(motor))

  /** Sends a built package; activates it unless the Pi is in the middle of a show. */
  async function send(pkg: ShowPackage, fetchAsset: (ref: ShowAssetRef) => Promise<ArrayBuffer>, activate: boolean) {
    if (!client || sending.value) return
    sendResult.value = null
    sendError.value = null
    sendProgress.value = null
    sendPhase.value = 'checking'
    try {
      const playing = status.value?.state === 'PLAYING'
      sendResult.value = await sendShowToPi({
        client,
        pkg,
        fetchAsset,
        activate: activate && !playing,
        onPhase: p => (sendPhase.value = p),
        onUploadProgress: p => (sendProgress.value = p)
      })
      sendPhase.value = sendResult.value.status === 'rejected' ? 'error' : 'done'
      void refreshLogs()
    } catch (e) {
      if (e instanceof PiApiError && (e.code === 'pin_invalid' || e.code === 'pin_required')) pinVerified.value = false
      sendError.value = message(e, 'No s’ha pogut enviar el show.')
      sendPhase.value = 'error'
    }
  }

  /** Plays a range of `pkg` on the Pi without storing it (see `rehearseOnPi`). */
  async function rehearse(pkg: ShowPackage, range: RehearsalRange, fetchAsset: (ref: ShowAssetRef) => Promise<ArrayBuffer>, onUpload?: (name: string) => void): Promise<RehearseResult> {
    if (!client) throw new PiApiError(0, 'not_connected', 'Connecta’t primer a la Raspberry.')
    try {
      const result = await rehearseOnPi({ client, pkg, range, fetchAsset, onUpload })
      if (result.status === 'started') status.value = result.piStatus
      return result
    } catch (e) {
      if (e instanceof PiApiError && (e.code === 'pin_invalid' || e.code === 'pin_required')) pinVerified.value = false
      throw e
    }
  }

  const endRehearsal = () => command('rehearsal', c => c.endRehearsal())

  function requestPanel() {
    panelRequests.value++
  }

  function resetSend() {
    sendPhase.value = null
    sendProgress.value = null
    sendResult.value = null
    sendError.value = null
  }

  return {
    url,
    pin,
    pinVerified,
    entry,
    info,
    status,
    statusAt,
    panelRequests,
    rehearsal,
    state,
    connecting,
    connected,
    streaming,
    error,
    logs,
    logError,
    busyCommand,
    alerts,
    lockedMotors,
    sendPhase,
    sendProgress,
    sendResult,
    sendError,
    sending,
    connect,
    autoConnect,
    disconnect,
    setPin,
    forgetPin,
    saveAddress,
    saveToStocka,
    refreshLogs,
    startLogs,
    stopLogs,
    play,
    stop,
    panic,
    clearAlerts,
    unlockMotor,
    send,
    resetSend,
    rehearse,
    endRehearsal,
    requestPanel
  }
})
