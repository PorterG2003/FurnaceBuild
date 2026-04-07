/**
 * Lightweight device + browser detection from `navigator.userAgent` for install UX.
 * Not for security; user-agent strings are spoofable.
 */

export type DeviceKind = 'ios' | 'android' | 'other';

export type BrowserKind =
  | 'safari'
  | 'chrome'
  | 'chrome_ios'
  | 'edge'
  | 'edge_ios'
  | 'firefox'
  | 'firefox_ios'
  | 'samsung_internet'
  | 'opera'
  | 'brave'
  | 'unknown';

export type ClientEnvironment = {
  device: DeviceKind;
  browser: BrowserKind;
  deviceLabel: string;
  browserLabel: string;
  /** Short line for UI, e.g. "iPhone · Chrome" */
  environmentTitle: string;
};

const BROWSER_LABELS: Record<BrowserKind, string> = {
  safari: 'Safari',
  chrome: 'Chrome',
  chrome_ios: 'Chrome',
  edge: 'Edge',
  edge_ios: 'Edge',
  firefox: 'Firefox',
  firefox_ios: 'Firefox',
  samsung_internet: 'Samsung Internet',
  opera: 'Opera',
  brave: 'Brave',
  unknown: 'Browser',
};

function parseBrowserKind(ua: string): BrowserKind {
  if (/SamsungBrowser/i.test(ua)) return 'samsung_internet';
  if (/EdgiOS/i.test(ua)) return 'edge_ios';
  if (/EdgA/i.test(ua)) return 'edge';
  if (/\bEdg\//i.test(ua)) return 'edge';
  if (/CriOS/i.test(ua)) return 'chrome_ios';
  if (/FxiOS/i.test(ua)) return 'firefox_ios';
  if (/OPR\//i.test(ua)) return 'opera';
  if (/Brave/i.test(ua)) return 'brave';
  if (/Firefox/i.test(ua)) return 'firefox';
  if (/Chrome|CrMo/i.test(ua)) return 'chrome';
  if (/Safari/i.test(ua)) return 'safari';
  return 'unknown';
}

function parseDeviceKind(ua: string): { device: DeviceKind; deviceLabel: string } {
  const isIpadOsDesktopUa = /Macintosh/i.test(ua) && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1;

  if (/iPad/i.test(ua) || isIpadOsDesktopUa) {
    return { device: 'ios', deviceLabel: 'iPad' };
  }
  if (/iPhone/i.test(ua)) {
    return { device: 'ios', deviceLabel: 'iPhone' };
  }
  if (/iPod/i.test(ua)) {
    return { device: 'ios', deviceLabel: 'iPod' };
  }
  if (/Android/i.test(ua)) {
    return { device: 'android', deviceLabel: 'Android' };
  }
  return { device: 'other', deviceLabel: 'This device' };
}

/** Browsers that commonly fire `beforeinstallprompt` on Android (Chromium family + Samsung). */
export function browserSupportsAndroidWebInstallPrompt(browser: BrowserKind): boolean {
  return (
    browser === 'chrome' ||
    browser === 'edge' ||
    browser === 'opera' ||
    browser === 'brave' ||
    browser === 'samsung_internet'
  );
}

export function parseClientEnvironment(): ClientEnvironment {
  if (typeof navigator === 'undefined') {
    return {
      device: 'other',
      browser: 'unknown',
      deviceLabel: 'This device',
      browserLabel: 'Browser',
      environmentTitle: 'This device',
    };
  }

  const ua = navigator.userAgent || '';
  const { device, deviceLabel } = parseDeviceKind(ua);
  const browser = parseBrowserKind(ua);
  const browserLabel = BROWSER_LABELS[browser];

  return {
    device,
    browser,
    deviceLabel,
    browserLabel,
    environmentTitle: `${deviceLabel} · ${browserLabel}`,
  };
}
