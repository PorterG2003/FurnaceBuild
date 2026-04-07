/**
 * Browser Web Push helpers (PWA). No-op on native.
 */

export function getWebPushVapidPublicKey(): string {
  return (process.env.EXPO_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY ?? '').trim();
}

function urlBase64ToUint8Array(base64String: string): BufferSource {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = typeof atob !== 'undefined' ? atob(base64) : Buffer.from(base64, 'base64').toString('binary');
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export async function getBrowserNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') {
    return 'unsupported';
  }
  return Notification.permission;
}

export async function subscribeWebPush(): Promise<{
  endpoint: string;
  keys: { p256dh: string; auth: string };
} | null> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return null;
  }
  if (!('PushManager' in window)) {
    throw new Error(
      'Alerts from this device need the Furnace app on your Home Screen. In Safari, use Share → Add to Home Screen, open that app, then enable alerts here.'
    );
  }

  const vapidPublic = getWebPushVapidPublicKey();
  if (!vapidPublic) {
    throw new Error('Missing EXPO_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY');
  }

  const perm = await Notification.requestPermission();
  if (perm !== 'granted') {
    return null;
  }

  await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublic),
  });

  const json = sub.toJSON();
  const key = json.keys;
  if (!json.endpoint || !key?.p256dh || !key?.auth) {
    throw new Error('Invalid push subscription from browser');
  }

  return {
    endpoint: json.endpoint,
    keys: { p256dh: key.p256dh, auth: key.auth },
  };
}

export async function unsubscribeWebPushCurrent(): Promise<void> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) await sub.unsubscribe();
}
