import assert from 'node:assert/strict';
import test from 'node:test';
import { CAMPAIGN_FLOW_EXAMPLE_CATEGORIZER, CAMPAIGN_FLOW_EXAMPLE_LINEAR } from './examples.js';
import {
  FlowEditForbiddenError,
  FlowRevisionConflictError,
  prepareFlowSave,
} from './prepareFlowSave.js';
import { computeFlowRevision } from './revision.js';
import type { CampaignFlowData, EmailNodeData } from './types.js';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function emailPriority(flow: CampaignFlowData, nodeId: string): boolean | undefined {
  const node = flow.nodes.find((n) => n.id === nodeId);
  return node && node.type === 'email' ? (node.data as EmailNodeData).priority : undefined;
}

function setEmailSubject(flow: CampaignFlowData, nodeId: string, subject: string): void {
  const node = flow.nodes.find((n) => n.id === nodeId);
  assert.ok(node && node.type === 'email');
  (node.data as EmailNodeData).variants[0]!.subject = subject;
}

function setEmailPriority(flow: CampaignFlowData, nodeId: string, priority: boolean): void {
  const node = flow.nodes.find((n) => n.id === nodeId);
  assert.ok(node && node.type === 'email');
  (node.data as EmailNodeData).priority = priority;
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

test('prepareFlowSave: canonical categorizer flow derives priority by position', async () => {
  // Downstream emails are priority regardless of subject; upstream emails are not.
  const flow = clone(CAMPAIGN_FLOW_EXAMPLE_CATEGORIZER);
  const result = await prepareFlowSave({
    incomingFlow: flow,
    existingFlow: { nodes: [], edges: [] },
    campaignStatus: 'draft',
    phase: 'draft',
  });

  assert.equal(emailPriority(result.flow, 'email-1'), false);
  assert.equal(emailPriority(result.flow, 'email-2'), false);
  assert.equal(emailPriority(result.flow, 'email-3'), true);
  assert.equal(emailPriority(result.flow, 'email-4'), true);
});

test('prepareFlowSave: priority email stored BEFORE the categorizer heals to false', async () => {
  // Reproduces the mass-stop bug: a pre-categorizer email marked priority.
  const flow = clone(CAMPAIGN_FLOW_EXAMPLE_CATEGORIZER);
  setEmailPriority(flow, 'email-2', true); // email-2 is upstream of the categorizer
  setEmailSubject(flow, 'email-2', ''); // even with no subject, upstream is always non-priority

  const result = await prepareFlowSave({
    incomingFlow: flow,
    existingFlow: { nodes: [], edges: [] },
    campaignStatus: 'draft',
    phase: 'draft',
  });

  assert.equal(emailPriority(result.flow, 'email-2'), false);
});

test('prepareFlowSave: giving a post-categorizer email a subject keeps it priority', async () => {
  const flow = clone(CAMPAIGN_FLOW_EXAMPLE_CATEGORIZER);
  setEmailSubject(flow, 'email-3', 'A brand new pitch, {{first_name}}');

  const result = await prepareFlowSave({
    incomingFlow: flow,
    existingFlow: { nodes: [], edges: [] },
    campaignStatus: 'draft',
    phase: 'draft',
  });

  assert.equal(emailPriority(result.flow, 'email-3'), true);
});

test('prepareFlowSave: priority heal rides along as a CONTENT edit on a running campaign', async () => {
  // Existing DB flow carries the legacy misconfiguration (email-2 = priority before
  // the categorizer). A normal content edit while running must be allowed AND
  // must persist the healed priority value.
  const existing = clone(CAMPAIGN_FLOW_EXAMPLE_CATEGORIZER);
  setEmailPriority(existing, 'email-2', true);

  const incoming = clone(existing);
  setEmailSubject(incoming, 'email-1', 'Edited subject while running');

  const result = await prepareFlowSave({
    incomingFlow: incoming,
    existingFlow: existing,
    campaignStatus: 'running',
    phase: 'draft',
  });

  assert.equal(result.lifecycle.allowed, true);
  assert.equal(result.changeKind, 'content');
  assert.equal(emailPriority(result.flow, 'email-2'), false);
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
