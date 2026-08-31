import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildLifecycleScheduleView,
  canResumeWithLifecycleSchedule,
  addYmdDays,
  decideLaunchStatus,
  earliestSelectableYmd,
  isCampaignSendEligible,
  isValidIanaTimeZone,
  localMidnightUtcIso,
  localYmd,
  nextStatusAfterLifecycleEdit,
  parseLifecycleScheduleBody,
  parseYmd,
  presentCampaignLifecycle,
  validateLifecycleSchedule,
  validateLifecycleScheduleForStatus,
} from './lifecycleSchedule';

test('parseYmd accepts valid calendar dates and rejects invalid ones', () => {
  assert.equal(parseYmd('2026-09-01'), '2026-09-01');
  assert.equal(parseYmd('2026-02-30'), null);
  assert.equal(parseYmd('09/01/2026'), null);
  assert.equal(parseYmd(null), null);
  assert.equal(parseYmd(''), null);
});

test('IANA timezone validation', () => {
  assert.equal(isValidIanaTimeZone('America/Chicago'), true);
  assert.equal(isValidIanaTimeZone('UTC'), true);
  assert.equal(isValidIanaTimeZone('Not/AZone'), false);
  assert.equal(isValidIanaTimeZone(''), false);
});

test('local midnight conversion is timezone-aware including DST', () => {
  const chicagoSummer = localMidnightUtcIso('2026-09-01', 'America/Chicago');
  const chicagoWinter = localMidnightUtcIso('2026-11-02', 'America/Chicago');
  const phoenix = localMidnightUtcIso('2026-09-01', 'America/Phoenix');
  assert.equal(chicagoSummer, '2026-09-01T05:00:00.000Z');
  assert.equal(chicagoWinter, '2026-11-02T06:00:00.000Z');
  assert.equal(phoenix, '2026-09-01T07:00:00.000Z');
});

test('addYmdDays shifts calendar dates across month boundaries', () => {
  assert.equal(addYmdDays('2026-08-31', 1), '2026-09-01');
  assert.equal(addYmdDays('2026-09-01', -1), '2026-08-31');
  assert.equal(addYmdDays('2026-01-31', 1), '2026-02-01');
  assert.equal(addYmdDays('2026-02-28', 1), '2026-03-01');
  assert.equal(addYmdDays('not-a-date', 1), null);
});

test('earliestSelectableYmd is tomorrow in the campaign timezone', () => {
  const afternoonUtc = new Date('2026-08-31T18:00:00.000Z');
  assert.equal(localYmd(afternoonUtc, 'America/Chicago'), '2026-08-31');
  assert.equal(earliestSelectableYmd(afternoonUtc, 'America/Chicago'), '2026-09-01');

  const lateEveningUtcStillChicagoToday = new Date('2026-09-01T04:30:00.000Z');
  assert.equal(localYmd(lateEveningUtcStillChicagoToday, 'America/Chicago'), '2026-08-31');
  assert.equal(earliestSelectableYmd(lateEveningUtcStillChicagoToday, 'America/Chicago'), '2026-09-01');
});

test('launch is running for empty or today, scheduled for future dates', () => {
  const now = new Date('2026-08-31T18:00:00.000Z');
  const todayChicago = localYmd(now, 'America/Chicago');
  assert.equal(decideLaunchStatus(null, 'America/Chicago', now), 'running');
  assert.equal(decideLaunchStatus(todayChicago, 'America/Chicago', now), 'running');
  assert.equal(decideLaunchStatus('2026-09-01', 'America/Chicago', now), 'scheduled');
});

test('half-open send eligibility is start_at <= now < pause_at', () => {
  const now = new Date('2026-09-01T12:00:00.000Z');
  assert.equal(isCampaignSendEligible({ status: 'running', now }), true);
  assert.equal(isCampaignSendEligible({
    status: 'running',
    startAt: '2026-09-01T05:00:00.000Z',
    pauseAt: '2026-10-01T05:00:00.000Z',
    now,
  }), true);
  assert.equal(isCampaignSendEligible({
    status: 'running',
    startAt: '2026-09-02T05:00:00.000Z',
    now,
  }), false);
  assert.equal(isCampaignSendEligible({
    status: 'running',
    pauseAt: '2026-09-01T12:00:00.000Z',
    now,
  }), false);
  assert.equal(isCampaignSendEligible({ status: 'scheduled', now }), false);
  assert.equal(isCampaignSendEligible({ status: 'running', deletedAt: now.toISOString(), now }), false);
});

test('API lifecycle_schedule object parsing requires complete nullable dates', () => {
  const parsed = parseLifecycleScheduleBody({
    time_zone: 'America/Chicago',
    start_on: '2026-09-01',
    pause_on: null,
  });
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.deepEqual(parsed.value, {
      time_zone: 'America/Chicago',
      start_on: '2026-09-01',
      pause_on: null,
    });
  }
  const cleared = parseLifecycleScheduleBody(null);
  assert.equal(cleared.ok, true);
  if (cleared.ok) assert.equal(cleared.value, null);

  const missingDates = parseLifecycleScheduleBody({ time_zone: 'America/Chicago' });
  assert.equal(missingDates.ok, false);
  const extra = parseLifecycleScheduleBody({
    time_zone: 'America/Chicago',
    start_on: null,
    pause_on: null,
    unexpected: true,
  });
  assert.equal(extra.ok, false);
});

test('pause_on must be after start_on and not already elapsed', () => {
  const now = new Date('2026-08-31T18:00:00.000Z');
  assert.equal(validateLifecycleSchedule({
    time_zone: 'America/Chicago',
    start_on: '2026-09-01',
    pause_on: '2026-09-01',
  }, now)?.code, 'invalid_lifecycle_dates');
  assert.equal(validateLifecycleSchedule({
    time_zone: 'America/Chicago',
    start_on: null,
    pause_on: '2026-08-31',
  }, now)?.code, 'pause_date_elapsed');
  assert.equal(validateLifecycleSchedule({
    time_zone: 'America/Chicago',
    start_on: '2026-09-01',
    pause_on: '2026-10-01',
  }, now), null);
});

test('status-aware edit rules lock running start/timezone and stopped dates', () => {
  const current = {
    time_zone: 'America/Chicago',
    start_on: '2026-09-01',
    pause_on: '2026-10-01',
  };
  assert.equal(validateLifecycleScheduleForStatus({
    status: 'running',
    current,
    next: { ...current, start_on: '2026-09-02' },
  })?.code, 'start_date_locked');
  assert.equal(validateLifecycleScheduleForStatus({
    status: 'running',
    current,
    next: { ...current, time_zone: 'America/New_York' },
  })?.code, 'timezone_locked');
  assert.equal(validateLifecycleScheduleForStatus({
    status: 'stopped',
    current,
    next: { ...current, pause_on: null },
  })?.code, 'lifecycle_schedule_locked');
  assert.equal(validateLifecycleScheduleForStatus({
    status: 'running',
    current,
    next: { ...current, pause_on: '2026-11-01' },
  }), null);
});

test('clearing a scheduled start launches immediately', () => {
  const now = new Date('2026-08-31T18:00:00.000Z');
  assert.equal(nextStatusAfterLifecycleEdit('scheduled', null, 'America/Chicago', now), 'running');
  assert.equal(nextStatusAfterLifecycleEdit('scheduled', '2026-09-02', 'America/Chicago', now), 'scheduled');
  assert.equal(nextStatusAfterLifecycleEdit('draft', '2026-09-01', 'America/Chicago', now), null);
});

test('elapsed pause blocks resume until cleared or moved', () => {
  const now = new Date('2026-10-01T12:00:00.000Z');
  assert.equal(canResumeWithLifecycleSchedule('2026-10-01', 'America/Chicago', now), false);
  assert.equal(canResumeWithLifecycleSchedule('2026-10-02', 'America/Chicago', now), true);
  assert.equal(canResumeWithLifecycleSchedule(null, 'America/Chicago', now), true);
});

test('presentCampaignLifecycle hides internal columns and returns derived instants', () => {
  const presented = presentCampaignLifecycle({
    id: 'c1',
    status: 'scheduled',
    schedule_timezone: 'America/Chicago',
    start_date: '2026-09-01',
    pause_date: null,
    start_at: '2026-09-01T05:00:00+00:00',
    pause_at: null,
  });
  assert.deepEqual(presented.lifecycle_schedule, {
    time_zone: 'America/Chicago',
    start_on: '2026-09-01',
    pause_on: null,
    start_at: '2026-09-01T05:00:00+00:00',
    pause_at: null,
  });
  assert.equal('start_date' in presented, false);
  assert.equal('start_at' in presented, false);
  assert.equal('schedule_timezone' in presented, false);
});

test('buildLifecycleScheduleView derives UTC instants from calendar dates', () => {
  assert.deepEqual(
    buildLifecycleScheduleView({
      time_zone: 'America/Chicago',
      start_on: '2026-09-01',
      pause_on: '2026-10-01',
    }),
    {
      time_zone: 'America/Chicago',
      start_on: '2026-09-01',
      pause_on: '2026-10-01',
      start_at: '2026-09-01T05:00:00.000Z',
      pause_at: '2026-10-01T05:00:00.000Z',
    },
  );
});
