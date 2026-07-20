import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CAMPAIGN_FLOW_EXAMPLE_DATASENDER,
  CAMPAIGN_FLOW_EXAMPLE_LINEAR,
} from './examples.js';
import { buildFlowConflictSummary, buildFlowPreviewSteps, isSpuriousFlowConflict } from './conflictSummary.js';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function getEmailNode(flow: typeof CAMPAIGN_FLOW_EXAMPLE_LINEAR, nodeId: string) {
  const node = flow.nodes.find((entry) => entry.id === nodeId);
  assert.ok(node && node.type === 'email');
  if (!node || node.type !== 'email') throw new Error(`missing email node ${nodeId}`);
  return node;
}

test('buildFlowPreviewSteps orders nodes from lead source', () => {
  const steps = buildFlowPreviewSteps(CAMPAIGN_FLOW_EXAMPLE_LINEAR, new Set());
  assert.equal(steps.length, CAMPAIGN_FLOW_EXAMPLE_LINEAR.nodes.length);
  assert.equal(steps[0]?.nodeId, 'leadSource-1');
  assert.equal(steps[1]?.nodeId, 'email-1');
});

test('buildFlowConflictSummary describes single-variant email subject changes', () => {
  const saved = clone(CAMPAIGN_FLOW_EXAMPLE_LINEAR);
  const local = clone(CAMPAIGN_FLOW_EXAMPLE_LINEAR);
  const emailNode = getEmailNode(local, 'email-2');
  emailNode.data.variants = [emailNode.data.variants[0]!];
  const savedEmailNode = getEmailNode(saved, 'email-2');
  savedEmailNode.data.variants = [savedEmailNode.data.variants[0]!];
  emailNode.data.variants[0]!.subject = 'Updated subject line';

  const summary = buildFlowConflictSummary(local, saved);
  const diff = summary.nodeDiffs.find((entry) => entry.nodeId === 'email-2');
  assert.ok(diff);
  assert.deepEqual(diff.fields.find((field) => field.label === 'Subject'), {
    label: 'Subject',
    yours: 'Updated subject line',
    saved: 'Bumping this for {{first_name}}',
  });
  assert.equal(diff.fields.some((field) => field.label === 'Variants'), false);
});

test('buildFlowConflictSummary ignores structuralBlocked lock flags', () => {
  const saved = clone(CAMPAIGN_FLOW_EXAMPLE_DATASENDER);
  const local = clone(CAMPAIGN_FLOW_EXAMPLE_DATASENDER);
  for (const node of local.nodes) {
    node.data = { ...node.data, structuralBlocked: true, canDelete: true };
  }
  for (const node of saved.nodes) {
    node.data = { ...node.data, structuralBlocked: false, canDelete: false };
  }

  const summary = buildFlowConflictSummary(local, saved);
  assert.equal(summary.nodeDiffs.length, 0);
  assert.equal(
    summary.nodeDiffs.some((diff) =>
      diff.fields.some((field) => field.label === 'structuralBlocked' || field.label === 'canDelete'),
    ),
    false,
  );
});

test('isSpuriousFlowConflict is true when only edge lock flags differ', () => {
  const saved = clone(CAMPAIGN_FLOW_EXAMPLE_LINEAR);
  const local = clone(CAMPAIGN_FLOW_EXAMPLE_LINEAR);
  local.edges = local.edges.map((edge) => ({
    ...edge,
    data: { ...(edge.data as object), readOnly: true, structuralBlocked: true },
  }));
  saved.edges = saved.edges.map((edge) => ({
    ...edge,
    data: { ...(edge.data as object), readOnly: false, structuralBlocked: false },
  }));

  assert.equal(isSpuriousFlowConflict(local, saved), true);
});

test('isSpuriousFlowConflict is false when email subject differs', () => {
  const saved = clone(CAMPAIGN_FLOW_EXAMPLE_LINEAR);
  const local = clone(CAMPAIGN_FLOW_EXAMPLE_LINEAR);
  getEmailNode(local, 'email-1').data.variants[0]!.subject = 'Changed';
  assert.equal(isSpuriousFlowConflict(local, saved), false);
});

test('buildFlowConflictSummary describes multi-variant subject changes per variant', () => {
  const saved = clone(CAMPAIGN_FLOW_EXAMPLE_LINEAR);
  const local = clone(CAMPAIGN_FLOW_EXAMPLE_LINEAR);
  const emailNode = getEmailNode(local, 'email-1');
  emailNode.data.variants[0]!.subject = 'Updated subject line';

  const summary = buildFlowConflictSummary(local, saved);
  assert.equal(summary.nodeDiffs.length, 1);
  assert.equal(summary.nodeDiffs[0]?.nodeId, 'email-1');
  assert.deepEqual(summary.nodeDiffs[0]?.fields[0], {
    label: 'Variant A · Subject',
    yours: 'Updated subject line',
    saved: 'Quick question for {{first_name}}',
  });
  assert.equal(summary.nodeDiffs[0]?.fields.some((field) => field.label === 'Subject'), false);
  assert.equal(summary.nodeDiffs[0]?.fields.some((field) => field.label === 'Variants'), false);
});

test('buildFlowConflictSummary describes full email body changes for single variant', () => {
  const saved = clone(CAMPAIGN_FLOW_EXAMPLE_LINEAR);
  const local = clone(CAMPAIGN_FLOW_EXAMPLE_LINEAR);
  const emailNode = getEmailNode(local, 'email-2');
  emailNode.data.variants = [emailNode.data.variants[0]!];
  const savedEmailNode = getEmailNode(saved, 'email-2');
  savedEmailNode.data.variants = [savedEmailNode.data.variants[0]!];
  emailNode.data.variants[0]!.template = 'Completely new body for {{first_name}} at {{custom.company}}.';

  const summary = buildFlowConflictSummary(local, saved);
  const bodyField = summary.nodeDiffs[0]?.fields.find((field) => field.label === 'Email body');
  assert.ok(bodyField);
  assert.equal(bodyField.yours, 'Completely new body for {{first_name}} at {{custom.company}}.');
  assert.equal(bodyField.saved, 'Hi {{first_name}} - circling back in case this is relevant for {{custom.company}}.');
});

test('buildFlowConflictSummary describes multi-variant B body changes only', () => {
  const saved = clone(CAMPAIGN_FLOW_EXAMPLE_LINEAR);
  const local = clone(CAMPAIGN_FLOW_EXAMPLE_LINEAR);
  const emailNode = getEmailNode(local, 'email-1');
  emailNode.data.variants[1]!.template = 'Variant B has a totally different body.';

  const summary = buildFlowConflictSummary(local, saved);
  const fields = summary.nodeDiffs[0]?.fields ?? [];
  assert.deepEqual(fields, [{
    label: 'Variant B · Email body',
    yours: 'Variant B has a totally different body.',
    saved: 'Hi {{first_name}} - wanted to share a quick idea for {{custom.company}}.',
  }]);
});

test('buildFlowConflictSummary describes added variant rows on local side', () => {
  const saved = clone(CAMPAIGN_FLOW_EXAMPLE_LINEAR);
  const local = clone(CAMPAIGN_FLOW_EXAMPLE_LINEAR);
  const emailNode = getEmailNode(local, 'email-2');
  emailNode.data.variants = [...emailNode.data.variants];
  emailNode.data.variants.push({
    id: '99999999-9999-4999-8999-999999999999',
    label: 'C',
    subject: 'New variant subject',
    template: 'New variant body',
    isActive: true,
    order: 2,
  });
  const savedEmailNode = getEmailNode(saved, 'email-2');
  savedEmailNode.data.variants = [savedEmailNode.data.variants[0]!];

  const summary = buildFlowConflictSummary(local, saved);
  const subjectField = summary.nodeDiffs.find((diff) => diff.nodeId === 'email-2')
    ?.fields.find((field) => field.label === 'Variant C · Subject');
  const bodyField = summary.nodeDiffs.find((diff) => diff.nodeId === 'email-2')
    ?.fields.find((field) => field.label === 'Variant C · Email body');
  assert.deepEqual(subjectField, {
    label: 'Variant C · Subject',
    yours: 'New variant subject',
    saved: null,
  });
  assert.deepEqual(bodyField, {
    label: 'Variant C · Email body',
    yours: 'New variant body',
    saved: null,
  });
});

test('buildFlowConflictSummary describes removed variant rows on saved side', () => {
  const saved = clone(CAMPAIGN_FLOW_EXAMPLE_LINEAR);
  const local = clone(CAMPAIGN_FLOW_EXAMPLE_LINEAR);
  const emailNode = getEmailNode(local, 'email-1');
  emailNode.data.variants = [emailNode.data.variants[0]!];

  const summary = buildFlowConflictSummary(local, saved);
  const subjectField = summary.nodeDiffs[0]?.fields.find((field) => field.label === 'Variant B · Subject');
  const bodyField = summary.nodeDiffs[0]?.fields.find((field) => field.label === 'Variant B · Email body');
  assert.deepEqual(subjectField, {
    label: 'Variant B · Subject',
    yours: null,
    saved: 'Following up for {{first_name}}',
  });
  assert.ok(bodyField);
  assert.equal(bodyField.yours, null);
  assert.equal(bodyField.saved, 'Hi {{first_name}} - wanted to share a quick idea for {{custom.company}}.');
});

test('buildFlowConflictSummary describes label-only changes', () => {
  const saved = clone(CAMPAIGN_FLOW_EXAMPLE_LINEAR);
  const local = clone(CAMPAIGN_FLOW_EXAMPLE_LINEAR);
  const emailNode = getEmailNode(local, 'email-1');
  emailNode.data.label = 'Renamed Intro Email';

  const summary = buildFlowConflictSummary(local, saved);
  assert.deepEqual(summary.nodeDiffs[0]?.fields[0], {
    label: 'Step name',
    yours: 'Renamed Intro Email',
    saved: 'Intro Email',
  });
});

test('buildFlowConflictSummary describes added steps with full snapshot', () => {
  const saved = clone(CAMPAIGN_FLOW_EXAMPLE_LINEAR);
  const local = clone(CAMPAIGN_FLOW_EXAMPLE_LINEAR);
  local.nodes.push({
    id: 'dataSender-1',
    type: 'dataSender',
    position: { x: 940, y: 0 },
    data: {
      label: 'Notify CRM',
      endpoint_url: 'https://example.com/hook',
      payload: '{"email":"{{email}}"}',
      on_failure: 'continue',
    },
  });

  const summary = buildFlowConflictSummary(local, saved);
  const added = summary.nodeDiffs.find((diff) => diff.nodeId === 'dataSender-1');
  assert.ok(added);
  assert.equal(added.kind, 'added');
  assert.ok(added.fields.some((field) => field.label === 'Webhook URL' && field.yours === 'https://example.com/hook'));
  assert.ok(added.fields.some((field) => field.label === 'Payload'));
  assert.equal(added.fields.filter((field) => field.label === 'Status').length, 0);
});

test('buildFlowConflictSummary describes removed steps with full snapshot', () => {
  const saved = clone(CAMPAIGN_FLOW_EXAMPLE_LINEAR);
  const local = clone(CAMPAIGN_FLOW_EXAMPLE_LINEAR);
  local.nodes = local.nodes.filter((node) => node.id !== 'waitTime-1');
  local.edges = local.edges.filter((edge) => edge.source !== 'waitTime-1' && edge.target !== 'waitTime-1');

  const summary = buildFlowConflictSummary(local, saved);
  const removed = summary.nodeDiffs.find((diff) => diff.nodeId === 'waitTime-1');
  assert.ok(removed);
  assert.equal(removed.kind, 'removed');
  assert.ok(removed.fields.some((field) => field.label === 'Wait' && field.saved === '1 day'));
});

test('buildFlowConflictSummary describes lead source field lists', () => {
  const saved = clone(CAMPAIGN_FLOW_EXAMPLE_LINEAR);
  const local = clone(CAMPAIGN_FLOW_EXAMPLE_LINEAR);
  const leadNode = local.nodes.find((node) => node.id === 'leadSource-1');
  assert.ok(leadNode && leadNode.type === 'leadSource');
  if (!leadNode || leadNode.type !== 'leadSource') throw new Error('missing lead source');
  leadNode.data.customFieldKeys = ['company', 'title'];

  const summary = buildFlowConflictSummary(local, saved);
  const customFields = summary.nodeDiffs[0]?.fields.find((field) => field.label === 'Custom fields');
  assert.deepEqual(customFields, {
    label: 'Custom fields',
    yours: 'company, title',
    saved: 'company',
  });
});

test('buildFlowConflictSummary describes dataSender payload changes with full JSON', () => {
  const saved = clone(CAMPAIGN_FLOW_EXAMPLE_DATASENDER);
  const local = clone(CAMPAIGN_FLOW_EXAMPLE_DATASENDER);
  const node = local.nodes.find((entry) => entry.id === 'dataSender-1');
  assert.ok(node && node.type === 'dataSender');
  if (!node || node.type !== 'dataSender') throw new Error('missing data sender');
  node.data.payload = JSON.stringify({ email: '{{email}}', title: '{{custom.title}}' }, null, 2);

  const summary = buildFlowConflictSummary(local, saved);
  const payloadField = summary.nodeDiffs[0]?.fields.find((field) => field.label === 'Payload');
  assert.ok(payloadField);
  assert.match(payloadField.yours ?? '', /"title": "{{custom.title}}"/);
  assert.doesNotMatch(payloadField.yours ?? '', /Changed/);
});

test('buildFlowConflictSummary ignores wait_duration_seconds-only delta', () => {
  const saved = clone(CAMPAIGN_FLOW_EXAMPLE_LINEAR);
  const local = clone(CAMPAIGN_FLOW_EXAMPLE_LINEAR);
  const waitNode = local.nodes.find((node) => node.id === 'waitTime-1');
  assert.ok(waitNode && waitNode.type === 'waitTime');
  if (!waitNode || waitNode.type !== 'waitTime') throw new Error('missing wait node');
  waitNode.data.wait_duration_seconds = 999999;

  const summary = buildFlowConflictSummary(local, saved);
  assert.equal(summary.nodeDiffs.length, 0);
});

test('buildFlowConflictSummary describes sequence changes', () => {
  const saved = clone(CAMPAIGN_FLOW_EXAMPLE_LINEAR);
  const local = clone(CAMPAIGN_FLOW_EXAMPLE_LINEAR);
  local.edges = local.edges.filter((edge) => edge.id !== 'e3');

  const summary = buildFlowConflictSummary(local, saved);
  assert.equal(typeof summary.sequenceSummary, 'string');
  assert.ok(summary.sequenceSummary!.length > 0);
});

test('buildFlowConflictSummary uses explicit field rows for unknown data keys', () => {
  const saved = clone(CAMPAIGN_FLOW_EXAMPLE_LINEAR);
  const local = clone(CAMPAIGN_FLOW_EXAMPLE_LINEAR);
  const waitNode = local.nodes.find((node) => node.id === 'waitTime-1');
  assert.ok(waitNode && waitNode.type === 'waitTime');
  if (!waitNode || waitNode.type !== 'waitTime') throw new Error('missing wait node');
  (waitNode.data as Record<string, unknown>).debugNote = 'local only';

  const summary = buildFlowConflictSummary(local, saved);
  const debugField = summary.nodeDiffs[0]?.fields.find((field) => field.label === 'debugNote');
  assert.deepEqual(debugField, {
    label: 'debugNote',
    yours: 'local only',
    saved: '(empty)',
  });
});
