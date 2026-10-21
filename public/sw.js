/* Service worker of the installed timeline editor: keeps the app itself available offline.
 *
 * - The SPA shell ("/") and every built file listed in /sw-manifest.json are cached on install and
 *   refreshed whenever a newer build is seen online.
 * - Navigations: network first, the cached shell when offline (every route renders the same shell).
 * - /_nuxt/* (hashed, immutable): cache first.
 * - Google Fonts: stale while revalidate.
 * - /api/* is never touched here: the app keeps its own copy of the data in IndexedDB.
 */
const PREFIX = 'stocka-editor-'
const FONTS = `${PREFIX}fonts`
const META = `${PREFIX}meta`
const SHELL = '/'
const MANIFEST_URL = '/sw-manifest.json'
const CHECK_EVERY_MS = 10 * 60 * 1000
let lastCheck = 0

async function currentCacheName() {
  const meta = await caches.open(META)
  const res = await meta.match('current')
  return res ? res.text() : null
}

/** Downloads the build listed in the manifest into its own cache when it is new. */
async function precache() {
  const res = await fetch(MANIFEST_URL, { cache: 'no-store' })
  if (!res.ok) return
  const manifest = await res.json()
  const name = `${PREFIX}build-${manifest.version}`
  if ((await currentCacheName()) === name) return
  const cache = await caches.open(name)
  await cache.addAll([SHELL, ...manifest.files])
  const meta = await caches.open(META)
  await meta.put('current', new Response(name))
  for (const key of await caches.keys()) {
    if (key.startsWith(`${PREFIX}build-`) && key !== name) await caches.delete(key)
  }
}

function maybeRefresh() {
  const now = Date.now()
  if (now - lastCheck < CHECK_EVERY_MS) return
  lastCheck = now
  precache().catch(() => {})
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache().catch(() => {}).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

async function fromBuildCache(request) {
  const name = await currentCacheName()
  if (name) {
    const hit = await (await caches.open(name)).match(request, { ignoreSearch: request.mode === 'navigate' })
    if (hit) return hit
  }
  return caches.match(request)
}

async function navigate(request) {
  try {
    const res = await fetch(request)
    if (res.ok) maybeRefresh()
    return res
  } catch {
    return (await fromBuildCache(new Request(SHELL))) || Response.error()
  }
}

async function cacheFirst(request) {
  const hit = await fromBuildCache(request)
  if (hit) return hit
  const res = await fetch(request)
  if (res.ok) {
    const name = (await currentCacheName()) || `${PREFIX}build-runtime`
    ;(await caches.open(name)).put(request, res.clone())
  }
  return res
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName)
  const hit = await cache.match(request)
  const network = fetch(request).then((res) => {
    if (res.ok || res.type === 'opaque') cache.put(request, res.clone())
    return res
  }).catch(() => hit)
  return hit || network
}

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) {
    if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
      event.respondWith(staleWhileRevalidate(request, FONTS))
    }
    return
  }
  if (url.pathname.startsWith('/api/')) return
  if (request.mode === 'navigate') {
    event.respondWith(navigate(request))
    return
  }
  if (url.pathname.startsWith('/_nuxt/')) {
    event.respondWith(cacheFirst(request))
    return
  }
  if (url.pathname === MANIFEST_URL || url.pathname === '/sw.js') return
  event.respondWith(fromBuildCache(request).then(hit => hit || fetch(request)))
})
