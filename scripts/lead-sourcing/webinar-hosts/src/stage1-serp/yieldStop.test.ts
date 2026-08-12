import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { YieldStopTracker, countNewUrls, resolveYieldStopConfig } from './yieldStop.js';

describe('yieldStop', () => {
  it('stops after one page with zero new urls', () => {
    const tracker = new YieldStopTracker(resolveYieldStopConfig({ zero_new_pages: 1 }));
    assert.equal(tracker.recordPage(3), 'continue');
    assert.equal(tracker.recordPage(0), 'stop_zero');
  });

  it('stops after low-yield streak', () => {
    const tracker = new YieldStopTracker(
      resolveYieldStopConfig({ zero_new_pages: 99, low_yield_threshold: 1, low_yield_streak: 2 }),
    );
    assert.equal(tracker.recordPage(1), 'continue');
    assert.equal(tracker.recordPage(1), 'stop_low_yield');
  });

  it('disables low-yield stop when threshold is zero', () => {
    const tracker = new YieldStopTracker(
      resolveYieldStopConfig({ low_yield_threshold: 0, low_yield_streak: 2 }),
    );
    assert.equal(tracker.recordPage(1), 'continue');
    assert.equal(tracker.recordPage(1), 'continue');
    assert.equal(tracker.recordPage(0), 'stop_zero');
  });

  it('resets tracker per query', () => {
    const tracker = new YieldStopTracker(resolveYieldStopConfig());
    tracker.recordPage(0);
    tracker.reset();
    assert.equal(tracker.recordPage(0), 'stop_zero');
  });

  it('counts new urls against seen set', () => {
    const seen = new Set(['https://example.com/a']);
    assert.equal(countNewUrls(['https://example.com/a', 'https://example.com/b'], seen), 1);
  });
});
