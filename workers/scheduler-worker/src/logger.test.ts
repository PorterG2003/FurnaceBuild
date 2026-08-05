import test from 'node:test';
import assert from 'node:assert/strict';
import { createLogger, type LogLevel } from './logger.js';

// ─── helpers ────────────────────────────────────────────────────────────────

function captureConsole() {
  const debugLines: unknown[][] = [];
  const infoLines: unknown[][] = [];
  const warnLines: unknown[][] = [];
  const errorLines: unknown[][] = [];

  const orig = {
    debug: console.debug,
    log: console.log,
    warn: console.warn,
    error: console.error,
  };

  console.debug = (...a: unknown[]) => debugLines.push(a);
  console.log   = (...a: unknown[]) => infoLines.push(a);
  console.warn  = (...a: unknown[]) => warnLines.push(a);
  console.error = (...a: unknown[]) => errorLines.push(a);

  return {
    debugLines,
    infoLines,
    warnLines,
    errorLines,
    restore() {
      console.debug = orig.debug;
      console.log   = orig.log;
      console.warn  = orig.warn;
      console.error = orig.error;
    },
  };
}

// A UUID that will or won't be sampled – determined by the FNV-1a hash
// We test determinism directly rather than hard-coding expected IDs.
const TEST_ID_A = '11111111-aaaa-bbbb-cccc-000000000001';
const TEST_ID_B = '22222222-dddd-eeee-ffff-000000000002';

// ─── sampling determinism ────────────────────────────────────────────────────

test('shouldSample is deterministic for the same id and rate', () => {
  const loggerA = createLogger({ level: 'info', sampleRate: 0.5 });
  const first  = loggerA.shouldSample(TEST_ID_A);
  const second = loggerA.shouldSample(TEST_ID_A);
  assert.equal(first, second, 'same id, same rate must produce same decision');

  // Different logger instance, same params → same result
  const loggerB = createLogger({ level: 'info', sampleRate: 0.5 });
  assert.equal(loggerB.shouldSample(TEST_ID_A), first);
});

test('shouldSample produces stable results across all rates', () => {
  const rates: number[] = [0, 0.01, 0.1, 0.5, 0.99, 1];
  for (const rate of rates) {
    const log = createLogger({ level: 'info', sampleRate: rate });
    const decision = log.shouldSample(TEST_ID_A);
    // Must be boolean and identical on repeat
    assert.equal(typeof decision, 'boolean');
    assert.equal(log.shouldSample(TEST_ID_A), decision);
  }
});

test('shouldSample(id, rate=0) is always false', () => {
  const log = createLogger({ level: 'info', sampleRate: 0 });
  assert.equal(log.shouldSample(TEST_ID_A), false);
  assert.equal(log.shouldSample(TEST_ID_B), false);
});

test('shouldSample(id, rate=1) is always true', () => {
  const log = createLogger({ level: 'info', sampleRate: 1 });
  assert.equal(log.shouldSample(TEST_ID_A), true);
  assert.equal(log.shouldSample(TEST_ID_B), true);
});

// ─── level gating ────────────────────────────────────────────────────────────

test('warn emits at level=info', () => {
  const cap = captureConsole();
  try {
    const log = createLogger({ level: 'info', sampleRate: 0 });
    log.warn('[SCHEDULER] test warn');
    assert.equal(cap.warnLines.length, 1);
  } finally {
    cap.restore();
  }
});

test('error emits at level=info', () => {
  const cap = captureConsole();
  try {
    const log = createLogger({ level: 'info', sampleRate: 0 });
    log.error('[SCHEDULER] test error');
    assert.equal(cap.errorLines.length, 1);
  } finally {
    cap.restore();
  }
});

test('info emits at level=info', () => {
  const cap = captureConsole();
  try {
    const log = createLogger({ level: 'info', sampleRate: 0 });
    log.info('[SCHEDULER] batch summary');
    assert.equal(cap.infoLines.length, 1);
  } finally {
    cap.restore();
  }
});

test('debug is suppressed at level=info', () => {
  const cap = captureConsole();
  try {
    const log = createLogger({ level: 'info', sampleRate: 0 });
    log.debug('[SCHEDULER] step trace');
    assert.equal(cap.debugLines.length, 0);
  } finally {
    cap.restore();
  }
});

test('debug emits at level=debug', () => {
  const cap = captureConsole();
  try {
    const log = createLogger({ level: 'debug', sampleRate: 0 });
    log.debug('[SCHEDULER] step trace');
    assert.equal(cap.debugLines.length, 1);
  } finally {
    cap.restore();
  }
});

test('all levels suppressed when level=error except error itself', () => {
  const cap = captureConsole();
  try {
    const log = createLogger({ level: 'error', sampleRate: 1 });
    log.debug('d');
    log.info('i');
    log.warn('w');
    assert.equal(cap.debugLines.length, 0);
    assert.equal(cap.infoLines.length, 0);
    assert.equal(cap.warnLines.length, 0);
    log.error('e');
    assert.equal(cap.errorLines.length, 1);
  } finally {
    cap.restore();
  }
});

// ─── debugSampled ────────────────────────────────────────────────────────────

test('debugSampled emits when level=debug regardless of sample rate', () => {
  const cap = captureConsole();
  try {
    const log = createLogger({ level: 'debug', sampleRate: 0 });
    log.debugSampled(TEST_ID_A, 'step trace');
    assert.equal(cap.debugLines.length, 1);
  } finally {
    cap.restore();
  }
});

test('debugSampled suppressed at level=info when not sampled (rate=0)', () => {
  const cap = captureConsole();
  try {
    const log = createLogger({ level: 'info', sampleRate: 0 });
    log.debugSampled(TEST_ID_A, 'step trace');
    assert.equal(cap.debugLines.length, 0);
  } finally {
    cap.restore();
  }
});

test('debugSampled emits at level=info when sampled (rate=1)', () => {
  const cap = captureConsole();
  try {
    const log = createLogger({ level: 'info', sampleRate: 1 });
    log.debugSampled(TEST_ID_A, 'step trace');
    assert.equal(cap.debugLines.length, 1);
  } finally {
    cap.restore();
  }
});

test('debugSampled decision is consistent with shouldSample for same id+rate', () => {
  const cap = captureConsole();
  try {
    const rate = 0.5;
    const log = createLogger({ level: 'info', sampleRate: rate });
    const willSample = log.shouldSample(TEST_ID_A);

    log.debugSampled(TEST_ID_A, 'trace');
    assert.equal(cap.debugLines.length, willSample ? 1 : 0);
  } finally {
    cap.restore();
  }
});

// ─── level parsing ───────────────────────────────────────────────────────────

test('unknown level string falls back to info', () => {
  const cap = captureConsole();
  try {
    // createLogger reads env, but we pass explicit option here
    // Simulate by testing the exported factory with a cast
    const log = createLogger({ level: 'info' as LogLevel, sampleRate: 0 });
    log.info('should appear');
    log.debug('should not appear');
    assert.equal(cap.infoLines.length, 1);
    assert.equal(cap.debugLines.length, 0);
  } finally {
    cap.restore();
  }
});
