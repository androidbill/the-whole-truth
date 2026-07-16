// The Whole Truth — service worker
// Network-first for navigations, cache-first for static assets.
// BASE-aware so it works at a subpath (e.g. GitHub Pages) or at the root.
const VERSION = '2026.07.15.03'
const CACHE = 'twt-' + VERSION
const BASE = new URL('./', self.location).pathname
const INDEX = BASE + 'index.html'
const SHELL = [BASE, INDEX, BASE + 'manifest.webmanifest', BASE + 'icons/icon-192.png', BASE + 'icons/icon-512.png']

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url)
  if (e.request.method !== 'GET' || url.origin !== location.origin) return
  // version.json must always hit the network — it drives the update prompt
  if (url.pathname.endsWith('/version.json')) return

  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put(INDEX, copy))
          return res
        })
        .catch(() => caches.match(INDEX))
    )
    return
  }

  e.respondWith(
    caches.match(e.request).then(
      (hit) =>
        hit ||
        fetch(e.request).then((res) => {
          if (res.ok) {
            const copy = res.clone()
            caches.open(CACHE).then((c) => c.put(e.request, copy))
          }
          return res
        })
    )
  )
})
