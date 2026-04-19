import test from 'node:test';
import assert from 'node:assert/strict';
import { SchedulerWorker } from './worker.js';

function createWorker() {
  return new SchedulerWorker({
    supabase: {} as any,
    databaseClient: {
      async poll() {
        return [];
      },
      getPollInterval() {
        return 1000;
      },
    } as any,
  });
}

test('SchedulerWorker single-flight intervals skip overlapping ticks', async () => {
  const worker = createWorker();
  (worker as any).running = true;

  const originalSetInterval = global.setInterval;
  const originalClearInterval = global.clearInterval;

  let intervalCallback: (() => void) | undefined;
  global.setInterval = ((callback: (...args: any[]) => void) => {
    intervalCallback = callback as () => void;
    return { id: 'timer-1' } as any;
  }) as typeof setInterval;
  global.clearInterval = (() => {}) as typeof clearInterval;

  let resolveTask: (() => void) | undefined;
  let executions = 0;

  try {
    (worker as any).startSingleFlightInterval({
      taskName: 'TEST TASK',
      intervalMs: 1000,
      task: async () => {
        executions += 1;
        await new Promise<void>((resolve) => {
          resolveTask = resolve;
        });
      },
      onError: () => {
        throw new Error('Unexpected task error');
      },
    });

    assert.ok(intervalCallback);

    intervalCallback();
    intervalCallback();
    await Promise.resolve();

    assert.equal(executions, 1);

    resolveTask?.();
    await Promise.resolve();
    await Promise.resolve();

    intervalCallback();
    await Promise.resolve();

    assert.equal(executions, 2);
  } finally {
    global.setInterval = originalSetInterval;
    global.clearInterval = originalClearInterval;
  }
});

test('SchedulerWorker.stop clears background timers', () => {
  const worker = createWorker();

  const timerHandles = [
    { id: 'interval-maintenance' },
    { id: 'stale-lock-cleanup' },
    { id: 'processed-interval-check' },
    { id: 'batch-interval-assignment' },
  ];
  (worker as any).intervalMaintenanceTimer = timerHandles[0];
  (worker as any).staleLockCleanupTimer = timerHandles[1];
  (worker as any).processedIntervalCheckTimer = timerHandles[2];
  (worker as any).batchIntervalAssignmentTimer = timerHandles[3];

  const originalClearInterval = global.clearInterval;
  const cleared: unknown[] = [];
  global.clearInterval = ((handle?: unknown) => {
    cleared.push(handle);
  }) as typeof clearInterval;

  try {
    worker.stop();
  } finally {
    global.clearInterval = originalClearInterval;
  }

  assert.deepEqual(cleared, timerHandles);
});
