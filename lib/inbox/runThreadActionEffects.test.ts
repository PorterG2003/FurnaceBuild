import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveOooResumeAt } from './runThreadActionEffects';

test('resolveOooResumeAt uses metadata return date for dated OOO', () => {
  const resumeAt = resolveOooResumeAt('mark_ooo_dated', {
    return_date: '2026-06-28',
  });
  assert.deepEqual(resumeAt, {
    resumeAt: '2026-06-28T12:00:00.000Z',
    returnDateYmd: '2026-06-28',
  });
});

test('resolveOooResumeAt uses now for instant OOO', () => {
  const before = Date.now();
  const resumeAt = resolveOooResumeAt('mark_ooo_instant', null);
  const after = Date.now();
  assert.ok(resumeAt);
  const parsed = new Date(resumeAt!.resumeAt).getTime();
  assert.ok(parsed >= before && parsed <= after + 1000);
  assert.equal(resumeAt!.returnDateYmd, null);
});

test('resolveOooResumeAt uses one month ahead for month OOO', () => {
  const before = Date.now() + 30 * 24 * 60 * 60 * 1000 - 1000;
  const resumeAt = resolveOooResumeAt('mark_ooo_month', null);
  const after = Date.now() + 30 * 24 * 60 * 60 * 1000 + 1000;
  assert.ok(resumeAt);
  const parsed = new Date(resumeAt!.resumeAt).getTime();
  assert.ok(parsed >= before && parsed <= after);
  assert.equal(resumeAt!.returnDateYmd, null);
});
