import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OOO_RESUME_DEFAULT_POLL_MS,
  OOO_RESUME_MAX_POLL_MS,
  OOO_RESUME_MIN_POLL_MS,
  OOO_RESUME_RPC_BATCH_SIZE,
  resolveOooResumePollIntervalMs,
  runOutOfOfficeResumeTick,
} from './ooo-resume-tick.js';

test('resolveOooResumePollIntervalMs uses 30m default when unset or non-numeric', () => {
  assert.equal(resolveOooResumePollIntervalMs(undefined), OOO_RESUME_DEFAULT_POLL_MS);
  assert.equal(resolveOooResumePollIntervalMs('not-a-number'), OOO_RESUME_DEFAULT_POLL_MS);
});

test('resolveOooResumePollIntervalMs treats empty string as 0 then clamps to min 60s', () => {
  assert.equal(resolveOooResumePollIntervalMs(''), OOO_RESUME_MIN_POLL_MS);
});

test('resolveOooResumePollIntervalMs clamps to min 60s and max 24h', () => {
  assert.equal(resolveOooResumePollIntervalMs('30000'), OOO_RESUME_MIN_POLL_MS);
  assert.equal(resolveOooResumePollIntervalMs('60000'), OOO_RESUME_MIN_POLL_MS);
  assert.equal(resolveOooResumePollIntervalMs(String(24 * 60 * 60 * 1000)), OOO_RESUME_MAX_POLL_MS);
  assert.equal(resolveOooResumePollIntervalMs(String(48 * 60 * 60 * 1000)), OOO_RESUME_MAX_POLL_MS);
});

test('runOutOfOfficeResumeTick calls process_due_out_of_office_resumes with batch size 50', async () => {
  const calls: unknown[] = [];
  const processed = await runOutOfOfficeResumeTick({
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return { data: 3, error: null };
    },
  } as any);
  assert.equal(processed, 3);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    name: 'process_due_out_of_office_resumes',
    args: { p_batch_size: OOO_RESUME_RPC_BATCH_SIZE },
  });
});

test('runOutOfOfficeResumeTick returns 0 when RPC data is not a number', async () => {
  const n = await runOutOfOfficeResumeTick({
    rpc: async () => ({ data: null, error: null }),
  } as any);
  assert.equal(n, 0);
});

test('runOutOfOfficeResumeTick propagates RPC errors', async () => {
  const err = { message: 'boom' };
  await assert.rejects(
    async () =>
      runOutOfOfficeResumeTick({
        rpc: async () => ({ data: null, error: err }),
      } as any),
    (thrown: unknown) => thrown === err
  );
});
