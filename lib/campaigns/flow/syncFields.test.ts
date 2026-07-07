import assert from 'node:assert/strict';
import test from 'node:test';
import { CAMPAIGN_FLOW_EXAMPLE_LINEAR } from './examples.js';
import { syncFields } from './syncFields.js';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

test('syncFields adds custom keys discovered in copy', () => {
  const flow = clone(CAMPAIGN_FLOW_EXAMPLE_LINEAR);
  const leadSource = flow.nodes.find((node) => node.type === 'leadSource');
  assert.ok(leadSource);
  leadSource!.data.customFieldKeys = [];
  const emailNode = flow.nodes.find((node) => node.id === 'email-1');
  assert.ok(emailNode && emailNode.type === 'email');
  if (!emailNode || emailNode.type !== 'email') throw new Error('missing email');
  emailNode.data.variants = emailNode.data.variants.map((variant) => ({
    ...variant,
    subject: 'Hello {{custom.industry}}',
    template: 'Hello {{custom.industry}}',
  }));

  const { flow: synced, field_sync } = syncFields(flow);
  const syncedLeadSource = synced.nodes.find((node) => node.type === 'leadSource');
  assert.ok(field_sync.declared_custom_added.includes('industry'));
  assert.ok(syncedLeadSource?.data.customFieldKeys?.includes('industry'));
});

test('syncFields does not prune removed custom tokens', () => {
  const flow = clone(CAMPAIGN_FLOW_EXAMPLE_LINEAR);
  const emailNode = flow.nodes.find((node) => node.id === 'email-1');
  assert.ok(emailNode && emailNode.type === 'email');
  if (!emailNode || emailNode.type !== 'email') throw new Error('missing email');
  emailNode.data.variants[0]!.template = 'Hello there';

  const { flow: synced } = syncFields(flow);
  const leadSource = synced.nodes.find((node) => node.type === 'leadSource');
  assert.ok(leadSource?.data.customFieldKeys?.includes('company'));
});
