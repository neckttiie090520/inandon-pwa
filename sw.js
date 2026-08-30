const CACHE = 'inandon-app-v4';
self.addEventListener('install', (e) => {
    e.waitUntil(caches.open(CACHE).then((c) =>
        Promise.all(['./', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'].map((u) =>
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
    // CDN ภายนอก (fonts / tabler icons): cache-first — เครื่องที่เคยเปิดแล้วไม่โหลดซ้ำจากเน็ต
    if (!url.startsWith(self.location.origin)) {
        if (event.request.method !== 'GET') return;
        if (!/^(https:\/\/fonts\.googleapis\.com\/|https:\/\/fonts\.gstatic\.com\/|https:\/\/cdn\.jsdelivr\.net\/)/.test(url)) return;
        event.respondWith(caches.open(CACHE).then(async (cache) => {
            const hit = await cache.match(event.request);
            if (hit) return hit;
            const res = await fetch(event.request);
            if (res.ok || res.type === 'opaque') cache.put(event.request, res.clone());
            return res;
        }));
        return;
    }
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
