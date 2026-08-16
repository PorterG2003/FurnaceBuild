import test from 'node:test';
import assert from 'node:assert/strict';
import { mapAccountWeeklyOutreachVolumeRows } from './account-weekly-outreach-volume-rpc-map';

test('mapAccountWeeklyOutreachVolumeRows normalizes dates and numeric strings', () => {
  const mapped = mapAccountWeeklyOutreachVolumeRows([
    { week_start: '2026-08-10', emails_sent: '12', leads_first_contacted: null },
    { week_start: '2026-08-17T00:00:00.000Z', emails_sent: 3, leads_first_contacted: 2 },
  ]);
  assert.deepEqual(mapped, [
    { weekStart: '2026-08-10', emailsSent: 12, leadsFirstContacted: 0 },
    { weekStart: '2026-08-17', emailsSent: 3, leadsFirstContacted: 2 },
  ]);
});
