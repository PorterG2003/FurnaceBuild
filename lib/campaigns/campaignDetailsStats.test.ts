import test from 'node:test';
import assert from 'node:assert/strict';
import {
  campaignChartBootstrapEnd,
  isCampaignDailyStatsCacheMiss,
} from './campaignDetailsStats';

const emptyDay = {
  sent: 0,
  replied: 0,
  positiveReply: 0,
  bounce: 0,
  leadsFirstContacted: 0,
};

test('isCampaignDailyStatsCacheMiss is false when lifetime sent is 0', () => {
  assert.equal(
    isCampaignDailyStatsCacheMiss({ series: [], lifetimeSentCount: 0 }),
    false,
  );
  assert.equal(
    isCampaignDailyStatsCacheMiss({ series: [emptyDay], lifetimeSentCount: 0 }),
    false,
  );
});

test('isCampaignDailyStatsCacheMiss is true when sends exist but the series is empty or all zeros', () => {
  assert.equal(
    isCampaignDailyStatsCacheMiss({ series: [], lifetimeSentCount: 12 }),
    true,
  );
  assert.equal(
    isCampaignDailyStatsCacheMiss({ series: [emptyDay, emptyDay], lifetimeSentCount: 3 }),
    true,
  );
});

test('isCampaignDailyStatsCacheMiss is false when the series has activity', () => {
  assert.equal(
    isCampaignDailyStatsCacheMiss({
      series: [{ ...emptyDay, sent: 2 }],
      lifetimeSentCount: 2,
    }),
    false,
  );
});

test('campaignChartBootstrapEnd caps at today and otherwise last activity plus two days', () => {
  assert.equal(campaignChartBootstrapEnd('2026-08-20', '2026-08-21'), '2026-08-21');
  assert.equal(campaignChartBootstrapEnd('2026-07-01', '2026-08-25'), '2026-07-03');
});
