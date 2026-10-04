// Install support and an offline app shell. Pages come from the network first, so a new deploy shows up
// right away; hashed build assets and the OCR engine never change under the same name, so they are served
// from the cache. Supabase requests go to another origin and are never touched.
const SHELL = 'shell-v1', ASSETS = 'assets-v1', MAX_ASSETS = 80
const scope = new URL(self.registration.scope)
const shellUrl = scope.href

const isCachedAsset = path => path.startsWith('assets/') || (path.startsWith('tesseract/') && !path.startsWith('tesseract/lang/'))

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const response = await fetch(shellUrl, { cache: 'no-cache' })
    if (!response.ok) return
    const html = await response.clone().text()
    await (await caches.open(SHELL)).put(shellUrl, response)
    // The scripts and styles of the page that registered the worker loaded before it, so fetch them now.
    const assets = [...html.matchAll(/(?:src|href)="([^"]*\/assets\/[^"]+)"/g)].map(match => new URL(match[1], shellUrl).href)
    await (await caches.open(ASSETS)).addAll(assets)
  })().catch(error => console.warn('Offline shell not cached', error)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== SHELL && key !== ASSETS) await caches.delete(key)
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', event => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return
  if (request.mode === 'navigate') event.respondWith(page(request))
  else if (isCachedAsset(url.pathname.slice(scope.pathname.length))) event.respondWith(asset(request))
})

async function page(request) {
  try {
    const response = await fetch(request)
    // GitHub Pages answers /check/<id> with 404.html, the same app; only real 200 pages refresh the shell.
    if (response.ok && response.headers.get('content-type')?.includes('text/html')) await (await caches.open(SHELL)).put(shellUrl, response.clone())
    return response
  } catch (error) {
    const cached = await caches.match(shellUrl, { ignoreVary: true })
    if (cached) return cached
    throw error
  }
}

async function asset(request) {
  // Module scripts are requested with an Origin header the precache request lacked; a hashed file is the same either way.
  const cached = await caches.match(request, { ignoreVary: true })
  if (cached) return cached
  const response = await fetch(request)
  if (response.ok) {
    const cache = await caches.open(ASSETS)
    await cache.put(request, response.clone())
    // Old builds leave hashed files behind; keep only the most recent ones.
    const keys = await cache.keys()
    for (const key of keys.slice(0, Math.max(0, keys.length - MAX_ASSETS))) await cache.delete(key)
  }
  return response
}
