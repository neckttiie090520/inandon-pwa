/* Service Worker — InAndOnBill PWA
   Cache-first สำหรับ shell assets, passthrough สำหรับ GAS API */
const STATIC_CACHE_KEY = 'inandon-shell-v3';
const PRECACHE = [
    './',
    './index.html',
    './styles.css',
    './app.js',
    './manifest.webmanifest',
    './icons/icon-192.png',
    './icons/icon-512.png',
    './icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(STATIC_CACHE_KEY).then((cache) => cache.addAll(PRECACHE))
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys.filter((k) => k !== STATIC_CACHE_KEY).map((k) => caches.delete(k)))
        )
    );
    self.clients.claim();
});

self.addEventListener('fetch', (event) => {
    const url = event.request.url;
    // GAS API + Google Fonts/Drive: ผ่านตรง (ข้อมูลสดเสมอ)
    if (url.includes('script.google.com') || url.includes('script.googleusercontent.com') ||
        url.includes('drive.google.com') || url.includes('fonts.googleapis.com') ||
        url.includes('fonts.gstatic.com') || url.includes('cdn.jsdelivr.net')) {
        event.respondWith(fetch(event.request));
        return;
    }
    // HTML/นำทาง: network-first — อัปเดตถึงเครื่องทันทีที่ deploy (offline ใช้ cache สำรอง)
    if (event.request.mode === 'navigate' ||
        (event.request.headers.get('accept') || '').includes('text/html')) {
        event.respondWith(
            fetch(event.request).then((res) => {
                const copy = res.clone();
                caches.open(STATIC_CACHE_KEY).then((c) => c.put('./index.html', copy));
                return res;
            }).catch(() => caches.match('./index.html'))
        );
        return;
    }
    // แอสเซ็ตอื่น: cache-first
    event.respondWith(
        caches.match(event.request).then((cached) => cached || fetch(event.request))
    );
});
