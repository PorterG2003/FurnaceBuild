import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ALL_LEASE_SCHEDULE_NAMES,
  DEFAULT_LEASE_MS,
  DEV_AWS_ACCOUNT_ID,
  DRAIN_DELAY_MS,
  ECS_UPDATE_SERVICE_TARGET_ARN,
  EXTENSION_GUARD_MS,
  LEASE_SCHEDULE_NAMES,
  MAX_LEASE_MS,
  assertDevOnlyAccount,
  assertLeaseWithinMax,
  assertNoProdTarget,
  buildShutdownSchedulePlan,
  canExtendLease,
  findUnresolvedLeaseSchedules,
  formatAtScheduleExpression,
  parseDuration,
  shouldRefuseNewLease,
} from './lease-dev-lib';

describe('parseDuration', () => {
  it('parses hours, minutes, and seconds', () => {
    assert.equal(parseDuration('2h'), 2 * 60 * 60 * 1000);
    assert.equal(parseDuration('90m'), 90 * 60 * 1000);
    assert.equal(parseDuration('30m'), 30 * 60 * 1000);
    assert.equal(parseDuration('45s'), 45 * 1000);
  });

  it('rejects invalid formats', () => {
    assert.throws(() => parseDuration(''), /required/i);
    assert.throws(() => parseDuration('2hours'), /invalid duration/i);
    assert.throws(() => parseDuration('0h'), /positive/i);
  });
});

describe('assertLeaseWithinMax', () => {
  it('allows up to 8 hours', () => {
    assert.doesNotThrow(() => assertLeaseWithinMax(MAX_LEASE_MS));
    assert.doesNotThrow(() => assertLeaseWithinMax(parseDuration('8h')));
  });

  it('rejects over 8 hours', () => {
    assert.throws(() => assertLeaseWithinMax(MAX_LEASE_MS + 1), /exceeds maximum/i);
    assert.throws(() => assertLeaseWithinMax(parseDuration('8h') + 1), /exceeds maximum/i);
  });
});

describe('DEFAULT_LEASE_MS', () => {
  it('defaults to 2 hours', () => {
    assert.equal(DEFAULT_LEASE_MS, parseDuration('2h'));
  });
});

describe('assertDevOnlyAccount', () => {
  it('accepts the dev account id', () => {
    assert.doesNotThrow(() => assertDevOnlyAccount(DEV_AWS_ACCOUNT_ID));
  });

  it('rejects other accounts', () => {
    assert.throws(() => assertDevOnlyAccount('123456789012'), /refusing dev lease/i);
  });
});

describe('assertNoProdTarget', () => {
  it('rejects prod in cluster/service/role names', () => {
    assert.throws(() => assertNoProdTarget('furnace-cluster-prod'), /prod target/i);
    assert.throws(() => assertNoProdTarget('WorkerStack-Prod-SendWorker'), /prod target/i);
    assert.throws(() => assertNoProdTarget('arn:aws:iam::686255981838:role/WorkerStack-Prod-Role'), /prod target/i);
  });

  it('allows dev-only names', () => {
    assert.doesNotThrow(() => assertNoProdTarget('furnace-cluster-dev'));
    assert.doesNotThrow(() => assertNoProdTarget('WorkerStack-Dev-SchedulerWorkerService-abc'));
  });
});

describe('buildShutdownSchedulePlan', () => {
  const serviceNames = {
    scheduler: 'sched-dev',
    send: 'send-dev',
    inbox: 'inbox-dev',
  };

  it('orders scheduler first, send/inbox +5m with stable schedule names', () => {
    const now = Date.parse('2026-08-04T18:00:00.000Z');
    const leaseMs = parseDuration('2h');
    const plan = buildShutdownSchedulePlan({
      now,
      leaseMs,
      clusterName: 'furnace-cluster-dev',
      serviceNames,
    });

    assert.equal(plan.schedulerAtMs, now + leaseMs);
    assert.equal(plan.sendAtMs, plan.schedulerAtMs + DRAIN_DELAY_MS);
    assert.equal(plan.inboxAtMs, plan.schedulerAtMs + DRAIN_DELAY_MS);

    assert.equal(plan.schedules[0].name, LEASE_SCHEDULE_NAMES.scheduler);
    assert.equal(plan.schedules[1].name, LEASE_SCHEDULE_NAMES.send);
    assert.equal(plan.schedules[2].name, LEASE_SCHEDULE_NAMES.inbox);

    for (const entry of plan.schedules) {
      assert.equal(entry.targetArn, ECS_UPDATE_SERVICE_TARGET_ARN);
      assert.equal(entry.actionAfterCompletion, 'DELETE');
      assert.equal(entry.flexibleTimeWindowMode, 'OFF');
      assert.equal(entry.maximumRetryAttempts, 0);
      assert.equal(entry.desiredCount, 0);
      assert.match(entry.scheduleExpression, /^at\(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\)$/);
    }
  });

  it('formats at() expressions in UTC without milliseconds', () => {
    const runAt = new Date('2026-08-04T20:00:00.000Z');
    assert.equal(formatAtScheduleExpression(runAt), 'at(2026-08-04T20:00:00)');
  });
});

describe('canExtendLease', () => {
  it('allows extension only when more than 10 minutes remain', () => {
    const now = 1_000_000;
    const expiry = now + EXTENSION_GUARD_MS + 1;
    assert.equal(canExtendLease({ now, schedulerExpiryMs: expiry }), true);
    assert.equal(canExtendLease({ now, schedulerExpiryMs: now + EXTENSION_GUARD_MS }), false);
    assert.equal(canExtendLease({ now, schedulerExpiryMs: now + 60_000 }), false);
  });
});

describe('shouldRefuseNewLease', () => {
  it('refuses when any unresolved schedule names remain', () => {
    assert.equal(shouldRefuseNewLease({ unresolvedScheduleNames: [] }), false);
    assert.equal(
      shouldRefuseNewLease({ unresolvedScheduleNames: [LEASE_SCHEDULE_NAMES.scheduler] }),
      true,
    );
    assert.equal(
      shouldRefuseNewLease({
        unresolvedScheduleNames: [LEASE_SCHEDULE_NAMES.send, LEASE_SCHEDULE_NAMES.inbox],
      }),
      true,
    );
  });

  it('findUnresolvedLeaseSchedules filters to known lease names only', () => {
    const unresolved = findUnresolvedLeaseSchedules([
      'other-schedule',
      LEASE_SCHEDULE_NAMES.scheduler,
      'another',
    ]);
    assert.deepEqual(unresolved, [LEASE_SCHEDULE_NAMES.scheduler]);
    assert.equal(ALL_LEASE_SCHEDULE_NAMES.length, 3);
  });
});
