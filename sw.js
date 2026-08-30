const CACHE = 'inandon-app-v3';
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
    // ข้าม cross-origin requests — SW จัดการเฉพาะ same-origin
    if (!event.request.url.startsWith(self.location.origin)) return;
    const url = event.request.url;
    if (event.request.mode === 'navigate' || (event.request.headers.get('accept') || '').includes('text/html')) {
        // เปิดแอปทันทีจาก cache แล้วอัปเดตในพื้นหลัง (stale-while-revalidate)
        // เดิม network-first: สัญญาณอ่อน/GAS เย็น = เปิดค้างจอดำจน network ตอบ
        event.respondWith((async () => {
            const cache = await caches.open(CACHE);
            const hit = await cache.match('./');
            const update = fetch(event.request).then((res) => {
                if (res.ok) { cache.put('./', res.clone()); }
                return res;
            });
            event.waitUntil(update.catch(() => {}));
            return hit || update;
        })());
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
