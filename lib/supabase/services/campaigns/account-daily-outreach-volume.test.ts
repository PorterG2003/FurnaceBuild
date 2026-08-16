import test from 'node:test';
import assert from 'node:assert/strict';
import { mapAccountDailyOutreachVolumeRows } from './account-daily-outreach-volume-rpc-map';

test('mapAccountDailyOutreachVolumeRows normalizes dates and numeric strings', () => {
  const mapped = mapAccountDailyOutreachVolumeRows([
    { stat_date: '2026-08-10', emails_sent: '12', leads_first_contacted: null },
    { stat_date: '2026-08-11T00:00:00.000Z', emails_sent: 3, leads_first_contacted: 2 },
  ]);
  assert.deepEqual(mapped, [
    { date: '2026-08-10', emailsSent: 12, leadsFirstContacted: 0 },
    { date: '2026-08-11', emailsSent: 3, leadsFirstContacted: 2 },
  ]);
});
