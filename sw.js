const CACHE = 'inandon-app-v1';
self.addEventListener('install', (e) => {
    e.waitUntil(caches.open(CACHE).then((c) =>
        Promise.all(['./', './manifest.webmanifest'].map((u) =>
            c.add(new Request(u, { cache: 'reload' })).catch(() => {})
        ))
    ));
    self.skipWaiting();
});
self.addEventListener('activate', (e) => {
    e.waitUntil(caches.keys().then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ));
    self.clients.claim();
});
self.addEventListener('fetch', (event) => {
    const url = event.request.url;
    if (event.request.mode === 'navigate' || (event.request.headers.get('accept') || '').includes('text/html')) {
        event.respondWith(fetch(event.request).catch(() => caches.match('./')));
        return;
    }
    event.respondWith(
        caches.match(event.request).then((hit) => hit || fetch(event.request).then((res) => {
            if (res.ok && url.startsWith(self.location.origin)) {
                const copy = res.clone();
                caches.open(CACHE).then((c) => c.put(event.request, copy));
            }
            return res;
        }).catch(() => hit))
    );
});
