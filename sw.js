const CACHE = 'acc-dj-shell-v1';
const SHELL = ['./','./index.html','./styles.css','./app.js','./manifest.webmanifest','./icons/icon.svg','./icons/placeholder.svg'];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL))));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))));
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return; // never cache music/API streams
  e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(r => {
    const clone = r.clone(); caches.open(CACHE).then(c => c.put(e.request, clone)); return r;
  })));
});
