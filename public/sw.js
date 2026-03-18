/**
 * Bare-bones service worker: install and activate only, zero caching.
 * Satisfies PWA "has a service worker" for Lighthouse; no fetch handler, no precache.
 */
self.addEventListener('install', function () {
  self.skipWaiting();
});
self.addEventListener('activate', function () {
  self.clients.claim();
});
