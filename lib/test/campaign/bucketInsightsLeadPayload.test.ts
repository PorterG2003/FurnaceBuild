import test from 'node:test';
import assert from 'node:assert/strict';
import { BUCKET_INSIGHTS_LEAD_COUNT } from '../../../scripts/seed/constants/bucketInsightsSmoke';
import { buildBucketInsightsLeadPayload } from '../../../scripts/seed/scenarios/bucket-insights-smoke';

function countFilled(field: 'last_name' | 'company_name' | 'website' | 'linkedin_url' | 'territory' | 'tier') {
  let filled = 0;
  for (let index = 0; index < BUCKET_INSIGHTS_LEAD_COUNT; index += 1) {
    const payload = buildBucketInsightsLeadPayload(index);
    if (field === 'territory') {
      if (payload.custom_lead_data?.territory) filled += 1;
    } else if (field === 'tier') {
      if (payload.custom_lead_data?.tier) filled += 1;
    } else if (payload[field]) {
      filled += 1;
    }
  }
  return filled;
}

test('bucket insights lead payload has predictable fill counts at 2500 rows', () => {
  assert.equal(countFilled('last_name'), 2000);
  assert.equal(countFilled('company_name'), 1500);
  assert.equal(countFilled('website'), 1000);
  assert.equal(countFilled('linkedin_url'), 500);
  assert.equal(countFilled('territory'), 1250);
  assert.equal(countFilled('tier'), 250);
});
