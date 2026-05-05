import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  buildOooRuntimeIntervalIsoTimes,
  OOO_RUNTIME_FIRST_INTERVAL_OFFSET_MS,
  OOO_RUNTIME_INTERVAL_COUNT,
  OOO_SEED_SENDING_INTERVAL_SECONDS,
} from './oooMixedInbox';

describe('buildOooRuntimeIntervalIsoTimes', () => {
  it('produces strictly future times relative to reference and correct count', () => {
    const referenceMs = Date.parse('2026-04-30T12:00:00.000Z');
    const times = buildOooRuntimeIntervalIsoTimes(referenceMs);
    assert.strictEqual(times.length, OOO_RUNTIME_INTERVAL_COUNT);

    const first = Date.parse(times[0]!);
    assert.ok(
      first >= referenceMs + OOO_RUNTIME_FIRST_INTERVAL_OFFSET_MS,
      'first interval should be at or after reference + offset'
    );

    for (let i = 1; i < times.length; i += 1) {
      const prev = Date.parse(times[i - 1]!);
      const cur = Date.parse(times[i]!);
      assert.strictEqual(
        cur - prev,
        OOO_SEED_SENDING_INTERVAL_SECONDS * 1000,
        `spacing at index ${i}`
      );
    }
  });
});
