/* App-Shell cache. API pozivi nikada ne idu iz keša. */
const CACHE = 'spesen-v2';
const SHELL = ['./', 'index.html', 'app.js', 'config.js',
               'logo.svg', 'manifest.webmanifest'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(k => Promise.all(k.filter(x => x !== CACHE).map(x => caches.delete(x))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.hostname.includes('script.google')) return;
  e.respondWith(
    fetch(e.request)
      .then(r => {
        const kopie = r.clone();
        caches.open(CACHE).then(c => c.put(e.request, kopie));
        return r;
      })
      .catch(() => caches.match(e.request))
  );
});
