import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_CAMPAIGN_SCHEDULE,
  DEFAULT_SENDING_INTERVAL_SECONDS,
  applyPreset,
  calculateEmailsPerMailboxPerDay,
} from './utils';

test('DEFAULT_CAMPAIGN_SCHEDULE matches business-hours preset', () => {
  assert.deepEqual(DEFAULT_CAMPAIGN_SCHEDULE, applyPreset('business-hours'));
  assert.equal(DEFAULT_CAMPAIGN_SCHEDULE.timezone, 'America/Chicago');
  assert.equal(DEFAULT_CAMPAIGN_SCHEDULE.start_hour, 9);
  assert.equal(DEFAULT_CAMPAIGN_SCHEDULE.end_hour, 17);
  assert.deepEqual(DEFAULT_CAMPAIGN_SCHEDULE.days_of_week, [1, 2, 3, 4, 5]);
});

test('DEFAULT_SENDING_INTERVAL_SECONDS is 24 minutes', () => {
  assert.equal(DEFAULT_SENDING_INTERVAL_SECONDS, 1440);
});

test('default schedule + 24-minute interval yields ~20 per scheduled day', () => {
  const text = calculateEmailsPerMailboxPerDay(DEFAULT_CAMPAIGN_SCHEDULE, 24);
  assert.match(text, /~20/);
  assert.match(text, /per scheduled day/);
});
