/**
 * PWA service worker: lifecycle + Web Push display and notification click (no fetch caching).
 *
 * Must stay in sync with app/(main)/_layout.tsx: message type `furnace-notification-navigate`.
 */
self.addEventListener('install', function () {
  self.skipWaiting();
});
self.addEventListener('activate', function () {
  self.clients.claim();
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
    icon: '/icon512_rounded.png',
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
