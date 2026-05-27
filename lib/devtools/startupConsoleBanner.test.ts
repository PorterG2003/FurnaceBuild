import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { logStartupConsoleBanner } from './startupConsoleBanner';

describe('logStartupConsoleBanner', () => {
  let callCount = 0;
  let lastCallArgs: unknown[] | undefined;
  const originalLog = console.log;

  afterEach(() => {
    delete globalThis.__furnaceStartupBannerShown;
    console.log = originalLog;
    callCount = 0;
    lastCallArgs = undefined;
  });

  it('logs the styled banner once per runtime', () => {
    console.log = (...args: unknown[]) => {
      callCount += 1;
      lastCallArgs = args;
    };

    logStartupConsoleBanner();
    logStartupConsoleBanner();

    assert.equal(callCount, 1);
    assert.equal(globalThis.__furnaceStartupBannerShown, true);

    const format = String(lastCallArgs?.[0] ?? '');
    assert.match(format, /found a bug\? that's porter's problem\./);
    assert.match(format, /porter@getfurnace\.io/);
    assert.ok(lastCallArgs?.includes('color:rgb(220, 29, 4)'));
    assert.ok(lastCallArgs?.includes('color:rgb(255, 53, 3)'));

    const pctCount = (format.match(/%c/g) ?? []).length;
    const styleCount = (lastCallArgs?.length ?? 0) - 1;
    assert.equal(styleCount, pctCount);
  });
});
