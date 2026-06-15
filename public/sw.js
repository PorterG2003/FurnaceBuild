/**
 * PWA service worker: lifecycle + pass-through fetch (installability) + Web Push.
 *
 * Must stay in sync with app/(main)/_layout.tsx: message type `furnace-notification-navigate`.
 *
 * Bump SW_BUILD when changing this file so installed PWAs pick up updates.
 */
var SW_BUILD = '2026-06-15-pwa-cache-fix';

self.addEventListener('install', function () {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim());
});

/**
 * Pass-through fetch handler so the page is controlled by this worker.
 * Navigation/HTML always goes to network first so deploys reach PWAs without reinstall.
 */
self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  try {
    var url = new URL(req.url);
    if (url.origin !== self.location.origin) return;
  } catch (e) {
    return;
  }

  var isDocument =
    req.mode === 'navigate' ||
    req.destination === 'document' ||
    (req.headers.get('accept') || '').indexOf('text/html') !== -1;

  if (isDocument) {
    event.respondWith(
      fetch(req).catch(function () {
        return new Response('', { status: 503, statusText: 'Network error' });
      })
    );
    return;
  }

  event.respondWith(
    fetch(req).catch(function () {
      return new Response('', { status: 503, statusText: 'Network error' });
    })
  );
});

function resolveNotificationUrl(raw) {
  try {
    return new URL(raw, self.location.origin).href;
  } catch (e) {
    return new URL('/inbox', self.location.origin).href;
  }
}

self.addEventListener('push', function (event) {
  var data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = {};
  }
  var title = data.title || 'Furnace';
  var options = {
    body: data.body || '',
    data: { url: data.url || '/' },
    tag: data.tag || 'furnace-notification',
    icon: '/web-app-manifest-512x512.png',
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var rawUrl = (event.notification.data && event.notification.data.url) || '/inbox';
  var absoluteUrl = resolveNotificationUrl(rawUrl);
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
      for (var i = 0; i < clientList.length; i++) {
        var client = clientList[i];
        if (client.url && 'focus' in client) {
          return client.focus().then(function () {
            if ('navigate' in client) {
              return client.navigate(absoluteUrl).catch(function () {
                client.postMessage({ type: 'furnace-notification-navigate', url: absoluteUrl });
              });
            }
            client.postMessage({ type: 'furnace-notification-navigate', url: absoluteUrl });
          });
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(absoluteUrl);
      }
    })
  );
});
