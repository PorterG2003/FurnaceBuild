import assert from 'node:assert/strict';
import test from 'node:test';
import { readProposalPlanTierFromSnapshot } from './proposalPlans';

test('readProposalPlanTierFromSnapshot returns stored tier only', () => {
  assert.equal(readProposalPlanTierFromSnapshot({ plan_tier: 'gold' }), 'gold');
  assert.equal(readProposalPlanTierFromSnapshot({ plan_tier: 'invalid' }), 'silver');
  assert.equal(readProposalPlanTierFromSnapshot({}, 'bronze'), 'bronze');
  assert.equal(readProposalPlanTierFromSnapshot(null, 'bronze'), 'bronze');
});

test('readProposalPlanTierFromSnapshot does not infer tier from unrelated fields', () => {
  assert.equal(
    readProposalPlanTierFromSnapshot({ monthly_retainer_cents: 400_000 }),
    'silver',
  );
});
