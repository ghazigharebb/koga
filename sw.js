/* the app moved to https://koga-wastaghareb.pages.dev/ — this removes the copy the old address kept on the device */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.map(k => caches.delete(k)))).then(() => self.registration.unregister()).then(() => self.clients.matchAll({ type: 'window' })).then(cs => cs.forEach(c => c.navigate('https://koga-wastaghareb.pages.dev/')))));
