import assert from 'node:assert';
import { afterEach, describe, it } from 'node:test';
import {
  INSTALL_GATE_ALWAYS_DISMISS_KEY,
  INSTALL_GATE_PENDING_RETURN_KEY,
  INSTALL_GATE_SESSION_CONTINUE_KEY,
  buildAuthHrefWithReturnTo,
  consumeInstallGatePendingReturn,
  hasInstallGateAlwaysDismissLocal,
  hasInstallGateSessionContinue,
  parseSafeAppReturnTo,
  setInstallGateAlwaysDismissLocal,
  setInstallGateSessionContinue,
  shouldShowIosSafariInstallSkipActions,
  stashInstallGatePendingReturn,
} from './installGateSkip';

type MemoryStorage = {
  store: Map<string, string>;
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

function createMemoryStorage(): MemoryStorage {
  const store = new Map<string, string>();
  return {
    store,
    getItem: (key) => (store.has(key) ? store.get(key)! : null),
    setItem: (key, value) => {
      store.set(key, value);
    },
    removeItem: (key) => {
      store.delete(key);
    },
  };
}

function withMockWindow(run: () => void) {
  const previousWindow = (globalThis as { window?: unknown }).window;
  const sessionStorage = createMemoryStorage();
  const localStorage = createMemoryStorage();
  const listeners = new Map<string, Set<() => void>>();

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      sessionStorage,
      localStorage,
      location: { pathname: '/inbox/thread-1', search: '', hash: '' },
      addEventListener: (type: string, handler: () => void) => {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type)!.add(handler);
      },
      removeEventListener: (type: string, handler: () => void) => {
        listeners.get(type)?.delete(handler);
      },
      dispatchEvent: (event: { type: string }) => {
        for (const handler of listeners.get(event.type) ?? []) handler();
        return true;
      },
    },
  });

  try {
    run();
  } finally {
    if (previousWindow === undefined) {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete (globalThis as { window?: unknown }).window;
    } else {
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: previousWindow,
      });
    }
  }
}

afterEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete (globalThis as { window?: unknown }).window;
});

describe('parseSafeAppReturnTo', () => {
  it('accepts relative app paths with query and hash', () => {
    assert.strictEqual(parseSafeAppReturnTo('/inbox/abc'), '/inbox/abc');
    assert.strictEqual(parseSafeAppReturnTo('/inbox/abc?x=1#y'), '/inbox/abc?x=1#y');
    assert.strictEqual(parseSafeAppReturnTo(encodeURIComponent('/campaigns')), '/campaigns');
  });

  it('rejects open redirects, auth, and install', () => {
    assert.strictEqual(parseSafeAppReturnTo('https://evil.example/inbox'), null);
    assert.strictEqual(parseSafeAppReturnTo('//evil.example/inbox'), null);
    assert.strictEqual(parseSafeAppReturnTo('/install'), null);
    assert.strictEqual(parseSafeAppReturnTo('/install/'), null);
    assert.strictEqual(parseSafeAppReturnTo('/auth'), null);
    assert.strictEqual(parseSafeAppReturnTo('/auth?return_to=%2Finbox'), null);
    assert.strictEqual(parseSafeAppReturnTo(''), null);
    assert.strictEqual(parseSafeAppReturnTo(undefined), null);
  });
});

describe('buildAuthHrefWithReturnTo', () => {
  it('encodes safe return targets and drops unsafe ones', () => {
    assert.strictEqual(
      buildAuthHrefWithReturnTo('/inbox/t1'),
      `/auth?return_to=${encodeURIComponent('/inbox/t1')}`,
    );
    assert.strictEqual(buildAuthHrefWithReturnTo('https://evil.example'), '/auth');
    assert.strictEqual(buildAuthHrefWithReturnTo(null), '/auth');
  });
});

describe('shouldShowIosSafariInstallSkipActions', () => {
  it('is true only for iOS Safari', () => {
    assert.strictEqual(
      shouldShowIosSafariInstallSkipActions({ device: 'ios', browser: 'safari' }),
      true,
    );
    assert.strictEqual(
      shouldShowIosSafariInstallSkipActions({ device: 'ios', browser: 'chrome_ios' }),
      false,
    );
    assert.strictEqual(
      shouldShowIosSafariInstallSkipActions({ device: 'android', browser: 'chrome' }),
      false,
    );
    assert.strictEqual(shouldShowIosSafariInstallSkipActions(null), false);
  });
});

describe('install gate storage skips', () => {
  it('stores this-tab Continue in sessionStorage', () => {
    withMockWindow(() => {
      assert.strictEqual(hasInstallGateSessionContinue(), false);
      setInstallGateSessionContinue();
      assert.strictEqual(hasInstallGateSessionContinue(), true);
      assert.strictEqual(window.sessionStorage.getItem(INSTALL_GATE_SESSION_CONTINUE_KEY), '1');
      assert.strictEqual(window.localStorage.getItem(INSTALL_GATE_ALWAYS_DISMISS_KEY), null);
    });
  });

  it('stores Always dismiss in localStorage', () => {
    withMockWindow(() => {
      assert.strictEqual(hasInstallGateAlwaysDismissLocal(), false);
      setInstallGateAlwaysDismissLocal('2026-08-13T00:00:00.000Z');
      assert.strictEqual(hasInstallGateAlwaysDismissLocal(), true);
      assert.strictEqual(
        window.localStorage.getItem(INSTALL_GATE_ALWAYS_DISMISS_KEY),
        '2026-08-13T00:00:00.000Z',
      );
      assert.strictEqual(window.sessionStorage.getItem(INSTALL_GATE_SESSION_CONTINUE_KEY), null);
    });
  });

  it('stashes and consumes a safe pending return', () => {
    withMockWindow(() => {
      stashInstallGatePendingReturn('/inbox/thread-1');
      assert.strictEqual(
        window.sessionStorage.getItem(INSTALL_GATE_PENDING_RETURN_KEY),
        '/inbox/thread-1',
      );
      assert.strictEqual(consumeInstallGatePendingReturn('/'), '/inbox/thread-1');
      assert.strictEqual(window.sessionStorage.getItem(INSTALL_GATE_PENDING_RETURN_KEY), null);
      assert.strictEqual(consumeInstallGatePendingReturn('/fallback'), '/fallback');
    });
  });

  it('ignores unsafe pending return targets', () => {
    withMockWindow(() => {
      stashInstallGatePendingReturn('https://evil.example/inbox');
      assert.strictEqual(window.sessionStorage.getItem(INSTALL_GATE_PENDING_RETURN_KEY), null);
    });
  });
});
