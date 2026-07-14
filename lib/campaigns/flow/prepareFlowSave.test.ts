import assert from 'node:assert/strict';
import test from 'node:test';
import { CAMPAIGN_FLOW_EXAMPLE_LINEAR } from './examples.js';
import {
  FlowEditForbiddenError,
  FlowRevisionConflictError,
  prepareFlowSave,
} from './prepareFlowSave.js';
import { computeFlowRevision } from './revision.js';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

test('prepareFlowSave returns field_sync and flow_revision', async () => {
  const flow = clone(CAMPAIGN_FLOW_EXAMPLE_LINEAR);
  const leadSource = flow.nodes.find((node) => node.type === 'leadSource');
  assert.ok(leadSource);
  leadSource!.data.customFieldKeys = [];

  const result = await prepareFlowSave({
    incomingFlow: flow,
    existingFlow: { nodes: [], edges: [] },
    campaignStatus: 'draft',
    phase: 'draft',
  });

  assert.equal(typeof result.flow_revision, 'string');
  assert.equal(result.flow_revision.length, 64);
  assert.ok(Array.isArray(result.field_sync.declared_custom_added));
});

test('prepareFlowSave throws on stale ifMatch', async () => {
  const existing = clone(CAMPAIGN_FLOW_EXAMPLE_LINEAR);
  const currentRevision = await computeFlowRevision(existing);
  await assert.rejects(
    () => prepareFlowSave({
      incomingFlow: existing,
      existingFlow: existing,
      campaignStatus: 'draft',
      ifMatch: `${currentRevision.slice(0, -1)}0`,
    }),
    FlowRevisionConflictError,
  );
});

test('prepareFlowSave allows structural edits on paused campaigns', async () => {
  const existing = clone(CAMPAIGN_FLOW_EXAMPLE_LINEAR);
  const structural = clone(CAMPAIGN_FLOW_EXAMPLE_LINEAR);
  structural.edges.pop();
  const result = await prepareFlowSave({
    incomingFlow: structural,
    existingFlow: existing,
    campaignStatus: 'paused',
    phase: 'draft',
  });
  assert.equal(result.changeKind, 'structural');
});

test('prepareFlowSave blocks all edits on stopped campaigns', async () => {
  const existing = clone(CAMPAIGN_FLOW_EXAMPLE_LINEAR);
  const content = clone(CAMPAIGN_FLOW_EXAMPLE_LINEAR);
  const emailNode = content.nodes.find((node) => node.id === 'email-1');
  assert.ok(emailNode && emailNode.type === 'email');
  if (!emailNode || emailNode.type !== 'email') {
    throw new Error('email node missing from example flow');
  }
  emailNode.data.variants[0]!.subject = 'Stopped edit';
  await assert.rejects(
    () => prepareFlowSave({
      incomingFlow: content,
      existingFlow: existing,
      campaignStatus: 'stopped',
      phase: 'draft',
    }),
    FlowEditForbiddenError,
  );
});

test('prepareFlowSave blocks structural edits on running campaigns', async () => {
  const existing = clone(CAMPAIGN_FLOW_EXAMPLE_LINEAR);
  const structural = clone(CAMPAIGN_FLOW_EXAMPLE_LINEAR);
  structural.edges.pop();
  await assert.rejects(
    () => prepareFlowSave({
      incomingFlow: structural,
      existingFlow: existing,
      campaignStatus: 'running',
      phase: 'draft',
    }),
    FlowEditForbiddenError,
  );
});

test('prepareFlowSave allows invalid flow data in draft with warnings', async () => {
  const invalid = { nodes: [], edges: [] };
  const result = await prepareFlowSave({
    incomingFlow: invalid,
    existingFlow: { nodes: [], edges: [] },
    campaignStatus: 'draft',
  });

  assert.ok(result.validation.warnings.length > 0);
  assert.equal(result.validation.blockingIssues.length, 0);
});
