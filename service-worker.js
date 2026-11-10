'use strict';

const CACHE_NAME = 'tiendasmart-github-v5';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/logo-minimarket.png',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './pos-offline.js',
  './libs/app-tailwind.css',
  './libs/lucide-0.468.0.min.js',
  './libs/xlsx.full.min.js',
  './libs/html2canvas-1.4.1.min.js',
  './libs/jspdf-2.5.1.umd.min.js',
  './libs/quagga2-1.8.4.min.js',
  './libs/firebase-app-9.22.2-compat.js',
  './libs/firebase-auth-9.22.2-compat.js',
  './libs/firebase-firestore-9.22.2-compat.js'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith('tiendasmart-github-') && key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if(request.method !== 'GET') return;
  const url = new URL(request.url);
  if(url.origin !== self.location.origin) return;

  if(request.mode === 'navigate'){
    // La caja instalada abre desde caché incluso si la conexión queda colgada.
    const refresh = fetch(request).then(async response => {
      if(response.ok && response.headers.get('content-type')?.includes('text/html')){
        const cache = await caches.open(CACHE_NAME);
        await cache.put('./index.html', response.clone());
      }
      return response;
    });
    event.waitUntil(refresh.catch(()=>{}));
    event.respondWith(caches.open(CACHE_NAME).then(async cache => (await cache.match('./index.html')) || refresh));
    return;
  }

  event.respondWith(
    caches.open(CACHE_NAME).then(cache => cache.match(request).then(cached => cached || fetch(request).then(response => {
      if(response && response.ok){
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request,copy));
      }
      return response;
    })))
  );
});

