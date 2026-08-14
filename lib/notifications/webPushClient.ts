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

export type WebPushDeviceStatusKind =
  | 'unsupported'
  | 'needs_install'
  | 'permission_default'
  | 'permission_denied'
  | 'permission_granted_unregistered'
  | 'local_only'
  | 'enabled';

export type WebPushDeviceStatus = {
  kind: WebPushDeviceStatusKind;
  permission: NotificationPermission | 'unsupported';
  localEndpoint: string | null;
  registeredInFurnace: boolean;
  label: string;
  detail: string;
};

export function classifyWebPushDeviceStatus(params: {
  permission: NotificationPermission | 'unsupported';
  pushManagerSupported: boolean;
  serviceWorkerSupported: boolean;
  localEndpoint: string | null;
  activeEndpoints: string[];
}): WebPushDeviceStatus {
  const { permission, pushManagerSupported, serviceWorkerSupported, localEndpoint, activeEndpoints } =
    params;
  const registeredInFurnace =
    !!localEndpoint && activeEndpoints.some((endpoint) => endpoint === localEndpoint);

  if (permission === 'unsupported' || !serviceWorkerSupported) {
    return {
      kind: 'unsupported',
      permission,
      localEndpoint,
      registeredInFurnace,
      label: 'Not supported',
      detail: 'This environment cannot show device alerts.',
    };
  }

  if (!pushManagerSupported) {
    return {
      kind: 'needs_install',
      permission,
      localEndpoint,
      registeredInFurnace,
      label: 'Install required',
      detail:
        'Add Furnace to your Home Screen (or use a browser that supports Web Push), then allow alerts here.',
    };
  }

  if (permission === 'denied') {
    return {
      kind: 'permission_denied',
      permission,
      localEndpoint,
      registeredInFurnace,
      label: 'Blocked in browser',
      detail: 'Notifications are blocked for this site. Enable them in browser settings, then retry.',
    };
  }

  if (permission === 'default') {
    return {
      kind: 'permission_default',
      permission,
      localEndpoint,
      registeredInFurnace,
      label: 'Not enabled',
      detail: 'Allow alerts on this browser so Furnace can notify you when it is in the background.',
    };
  }

  // permission === 'granted'
  if (registeredInFurnace) {
    return {
      kind: 'enabled',
      permission,
      localEndpoint,
      registeredInFurnace: true,
      label: 'Enabled on this device',
      detail: 'This browser is registered for device push. Turn on categories below.',
    };
  }

  if (localEndpoint) {
    return {
      kind: 'local_only',
      permission,
      localEndpoint,
      registeredInFurnace: false,
      label: 'Needs sync',
      detail: 'Browser permission is on, but Furnace does not have this device yet. Update below.',
    };
  }

  return {
    kind: 'permission_granted_unregistered',
    permission,
    localEndpoint: null,
    registeredInFurnace: false,
    label: 'Permission granted',
    detail: 'Browser permission is on. Register this device to finish setup.',
  };
}

/** Read-only snapshot of this browser’s push readiness vs Furnace-stored endpoints. */
export async function resolveWebPushDeviceStatus(
  activeEndpoints: string[]
): Promise<WebPushDeviceStatus> {
  if (typeof window === 'undefined') {
    return classifyWebPushDeviceStatus({
      permission: 'unsupported',
      pushManagerSupported: false,
      serviceWorkerSupported: false,
      localEndpoint: null,
      activeEndpoints,
    });
  }

  const permission = await getBrowserNotificationPermission();
  const serviceWorkerSupported = 'serviceWorker' in navigator;
  const pushManagerSupported = 'PushManager' in window;

  let localEndpoint: string | null = null;
  if (serviceWorkerSupported && pushManagerSupported) {
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      localEndpoint = sub?.endpoint ?? null;
    } catch {
      localEndpoint = null;
    }
  }

  return classifyWebPushDeviceStatus({
    permission,
    pushManagerSupported,
    serviceWorkerSupported,
    localEndpoint,
    activeEndpoints,
  });
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
