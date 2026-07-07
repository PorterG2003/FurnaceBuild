import assert from 'node:assert/strict';
import test from 'node:test';
import { CAMPAIGN_FLOW_EXAMPLE_LINEAR } from '../campaigns/flow/examples.js';
import { buildLaunchState, buildLeadFieldState } from './campaign-document.js';

test('buildLaunchState reports not ready when mailboxes missing', () => {
  const state = buildLaunchState(
    { name: 'Test', status: 'draft', flow_data: CAMPAIGN_FLOW_EXAMPLE_LINEAR as never },
    { mailboxCount: 0, leadCount: 1 },
  );
  assert.equal(state.ready, false);
  assert.equal(state.checks.has_mailboxes, false);
});

test('buildLeadFieldState counts incomplete custom fields', () => {
  const state = buildLeadFieldState(CAMPAIGN_FLOW_EXAMPLE_LINEAR as never, [
    { custom_lead_data: { company: 'Acme' } },
    { custom_lead_data: {} },
  ]);
  assert.equal(state.incomplete_lead_count, 1);
  assert.equal(state.total_lead_count, 2);
  assert.ok(state.declared_custom_field_keys.includes('company'));
});
