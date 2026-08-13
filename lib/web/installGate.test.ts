import assert from 'node:assert';
import { afterEach, describe, it } from 'node:test';
import {
  getCurrentWebPathname,
  isFluxPublicLandingRoute,
  isInstallGateExemptRoute,
  shouldBypassWebInstallGate,
} from './installGate';
import {
  INSTALL_GATE_ALWAYS_DISMISS_KEY,
  INSTALL_GATE_SESSION_CONTINUE_KEY,
  setInstallGateAlwaysDismissLocal,
  setInstallGateSessionContinue,
} from './installGateSkip';

describe('isInstallGateExemptRoute', () => {
  it('exempts /install', () => {
    assert.strictEqual(isInstallGateExemptRoute('/install'), true);
    assert.strictEqual(isInstallGateExemptRoute('/install/'), true);
  });

  it('exempts Flux public landing pages under /p/', () => {
    assert.strictEqual(isInstallGateExemptRoute('/p'), true);
    assert.strictEqual(isInstallGateExemptRoute('/p/acme-corp'), true);
    assert.strictEqual(isInstallGateExemptRoute('/p/acme-corp/'), true);
  });

  it('exempts public invite acceptance routes', () => {
    assert.strictEqual(isInstallGateExemptRoute('/accept-platform-invite/abc'), true);
    assert.strictEqual(isInstallGateExemptRoute('/accept-invitation/abc'), true);
    assert.strictEqual(isInstallGateExemptRoute('/accept-account-amendment/abc'), true);
    assert.strictEqual(isInstallGateExemptRoute('/mcp/oauth/consent'), true);
    assert.strictEqual(isInstallGateExemptRoute('/mcp/oauth/consent/'), true);
  });

  it('exempts invite-scoped auth routes', () => {
    assert.strictEqual(isInstallGateExemptRoute('/auth', '?invitation_id=abc'), true);
    assert.strictEqual(isInstallGateExemptRoute('/auth', 'invitation_id=abc'), true);
    assert.strictEqual(isInstallGateExemptRoute('/auth', '?amendment_id=abc'), true);
    assert.strictEqual(
      isInstallGateExemptRoute(
        '/auth',
        `?return_to=${encodeURIComponent('/mcp/oauth/consent?client_id=x')}`,
      ),
      true,
    );
    assert.strictEqual(
      isInstallGateExemptRoute('/auth', `?return_to=${encodeURIComponent('/account')}`),
      true,
    );
    assert.strictEqual(
      isInstallGateExemptRoute('/auth', `?return_to=${encodeURIComponent('https://evil.example')}`),
      false,
    );
  });

  it('exempts routes carrying valid public access dialog params', () => {
    assert.strictEqual(
      isInstallGateExemptRoute(
        '/auth',
        '?access_flow=platform_invite&access_issue=resource_completed',
      ),
      true,
    );
    assert.strictEqual(
      isInstallGateExemptRoute(
        '/',
        '?access_flow=platform_invite&access_issue=resource_completed',
      ),
      true,
    );
    assert.strictEqual(
      isInstallGateExemptRoute(
        '/account',
        '?access_flow=team_invite&access_issue=resource_completed',
      ),
      true,
    );
    assert.strictEqual(
      isInstallGateExemptRoute(
        '/auth',
        '?access_flow=platform_invite&access_issue=wrong_email&access_resource_id=abc',
      ),
      true,
    );
    assert.strictEqual(
      isInstallGateExemptRoute(
        '/auth',
        '?access_flow=account_amendment&access_issue=not_owner',
      ),
      true,
    );
  });

  it('does not exempt other app routes', () => {
    assert.strictEqual(isInstallGateExemptRoute('/auth'), false);
    assert.strictEqual(isInstallGateExemptRoute('/'), false);
    assert.strictEqual(isInstallGateExemptRoute('/campaigns'), false);
    assert.strictEqual(isInstallGateExemptRoute('/account'), false);
    assert.strictEqual(isInstallGateExemptRoute('/flux'), false);
    assert.strictEqual(isInstallGateExemptRoute('/preview'), false);
    assert.strictEqual(
      isInstallGateExemptRoute('/campaigns', '?access_flow=platform_invite'),
      false,
    );
  });
});

describe('isFluxPublicLandingRoute', () => {
  it('matches /p and /p/{slug}', () => {
    assert.strictEqual(isFluxPublicLandingRoute('/p'), true);
    assert.strictEqual(isFluxPublicLandingRoute('/p/acme-corp'), true);
    assert.strictEqual(isFluxPublicLandingRoute('/p/acme-corp/'), true);
    assert.strictEqual(isFluxPublicLandingRoute('/flux'), false);
  });
});

describe('getCurrentWebPathname', () => {
  it('prefers the live browser pathname when available', () => {
    const previousWindow = globalThis.window;
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { location: { pathname: '/p/acme-corp/' } },
    });

    try {
      assert.strictEqual(getCurrentWebPathname('/fallback'), '/p/acme-corp/');
    } finally {
      if (previousWindow === undefined) {
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete (globalThis as { window?: Window }).window;
      } else {
        Object.defineProperty(globalThis, 'window', {
          configurable: true,
          value: previousWindow,
        });
      }
    }
  });
});

describe('shouldBypassWebInstallGate skip storage', () => {
  const previousDev = (globalThis as { __DEV__?: boolean }).__DEV__;

  afterEach(() => {
    (globalThis as { __DEV__?: boolean }).__DEV__ = previousDev;
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete (globalThis as { window?: unknown }).window;
  });

  function withNarrowBrowserWindow(run: () => void) {
    const sessionStore = new Map<string, string>();
    const localStore = new Map<string, string>();
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
        sessionStorage: {
          getItem: (k: string) => (sessionStore.has(k) ? sessionStore.get(k)! : null),
          setItem: (k: string, v: string) => {
            sessionStore.set(k, v);
          },
          removeItem: (k: string) => {
            sessionStore.delete(k);
          },
        },
        localStorage: {
          getItem: (k: string) => (localStore.has(k) ? localStore.get(k)! : null),
          setItem: (k: string, v: string) => {
            localStore.set(k, v);
          },
          removeItem: (k: string) => {
            localStore.delete(k);
          },
        },
        dispatchEvent: () => true,
        navigator: {},
      },
    });
    run();
  }

  it('bypasses for this-tab Continue and Always dismiss outside __DEV__', () => {
    withNarrowBrowserWindow(() => {
      (globalThis as { __DEV__?: boolean }).__DEV__ = false;
      assert.strictEqual(shouldBypassWebInstallGate(390), false);

      setInstallGateSessionContinue();
      assert.strictEqual(shouldBypassWebInstallGate(390), true);
      assert.strictEqual(window.sessionStorage.getItem(INSTALL_GATE_SESSION_CONTINUE_KEY), '1');

      window.sessionStorage.removeItem(INSTALL_GATE_SESSION_CONTINUE_KEY);
      assert.strictEqual(shouldBypassWebInstallGate(390), false);

      setInstallGateAlwaysDismissLocal('2026-08-13T00:00:00.000Z');
      assert.strictEqual(shouldBypassWebInstallGate(390), true);
      assert.strictEqual(
        window.localStorage.getItem(INSTALL_GATE_ALWAYS_DISMISS_KEY),
        '2026-08-13T00:00:00.000Z',
      );
    });
  });
});
