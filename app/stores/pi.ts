import { defineStore } from 'pinia'
import type { ShowAssetRef, ShowPackage } from '~/types/show'
import { DEFAULT_PI_URLS, normalizePiUrl, PiApiError, PiClient, type PiInfo, type PiStatus, type UploadProgress } from '~/utils/pi/piClient'
import { sendShowToPi, type SendPhase, type SendShowResult } from '~/utils/pi/sendShow'

const URL_KEY = 'stocka.pi.url'
const PIN_KEY = 'stocka.pi.pin'
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
 * The belén Raspberry Pi as seen from the installed editor: where it is on the local network, the
 * PIN for commands (kept for the browser session only), its live status, its log, and sending the
 * open show to it. Works without Internet: only the laptop and the Pi on the same network.
 */
export const usePiStore = defineStore('pi', () => {
  const url = ref<string>(readStorage('local', URL_KEY) ?? DEFAULT_PI_URLS[0])
  const pin = ref<string | null>(readStorage('session', PIN_KEY))
  const pinVerified = ref(false)
  const info = ref<PiInfo | null>(null)
  const status = ref<PiStatus | null>(null)
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
  const alerts = computed(() => status.value?.alerts ?? [])
  const lockedMotors = computed(() => Object.entries(status.value?.motors ?? {}).filter(([, m]) => m.locked).map(([name]) => name))
  const state = computed(() => status.value?.state ?? info.value?.state ?? null)
  const sending = computed(() => sendPhase.value !== null && sendPhase.value !== 'done' && sendPhase.value !== 'error')

  function actorName(): string {
    const user = useAuthStore().user
    return [user?.name, user?.lastName].filter(Boolean).join(' ') || user?.email || 'editor'
  }

  function newClient(address: string): PiClient {
    return new PiClient(address, { pin: pin.value, name: actorName() })
  }

  function disconnect() {
    stopWatch?.()
    stopWatch = null
    stopLogs()
    client = null
    info.value = null
    status.value = null
    streaming.value = false
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
      status.value = await c.status().catch(() => null)
      stopWatch = c.watch((s) => {
        status.value = s
        streaming.value = true
      }, () => {
        streaming.value = false
      })
      if (pin.value) pinVerified.value = await c.checkPin(pin.value).catch(() => false)
      return true
    } catch (e) {
      error.value = message(e, 'No s’ha pogut connectar amb la Raspberry.')
      return false
    } finally {
      connecting.value = false
    }
  }

  /** Tries the saved address, then the usual ones (`belen.local`, the Pi's own Wi-Fi). */
  async function autoConnect(): Promise<boolean> {
    const candidates = [...new Set([url.value, ...DEFAULT_PI_URLS])]
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
      writeStorage('session', PIN_KEY, trimmed)
      return true
    } catch (e) {
      error.value = message(e, 'No s’ha pogut comprovar el PIN.')
      return false
    }
  }

  function forgetPin() {
    pin.value = null
    pinVerified.value = false
    if (client) client.pin = null
    writeStorage('session', PIN_KEY, null)
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
    info,
    status,
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
    refreshLogs,
    startLogs,
    stopLogs,
    play,
    stop,
    panic,
    clearAlerts,
    unlockMotor,
    send,
    resetSend
  }
})
