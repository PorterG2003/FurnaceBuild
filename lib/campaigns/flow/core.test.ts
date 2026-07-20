import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CAMPAIGN_FLOW_EXAMPLE_LINEAR,
  assertFlowEditAllowed,
  classifyFlowChange,
  normalizeFlowData,
  validateFlowData,
  validateForPhase,
} from './index.js';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

test('normalizeFlowData canonicalizes wait nodes and categorizer edges', () => {
  const normalized = normalizeFlowData({
    nodes: [
      {
        id: 'leadSource-1',
        type: 'leadSource',
        selected: true,
        position: { x: 0, y: 0 },
        data: {},
      },
      {
        id: 'waitTime-1',
        type: 'waitTime',
        position: { x: 10, y: 20 },
        data: { duration: '2', unit: 'hours' },
      },
      {
        id: 'aiCategorizer-1',
        type: 'aiCategorizer',
        position: { x: 20, y: 40 },
        data: {},
      },
      {
        id: 'email-1',
        type: 'email',
        position: { x: 30, y: 60 },
        data: {
          subject: 'Hi',
          template: 'Hello there',
        },
      },
    ],
    edges: [
      {
        id: 'edge-aiCategorizer-1not-interested-email-1',
        source: 'aiCategorizer-1',
        target: 'email-1',
      },
    ],
  });

  const waitNode = normalized.nodes.find((node) => node.id === 'waitTime-1');
  assert.equal(waitNode?.data.wait_duration_seconds, 7200);
  assert.equal(waitNode?.data.duration, '2');
  assert.equal(waitNode?.data.unit, 'hours');

  const leadSourceNode = normalized.nodes.find((node) => node.id === 'leadSource-1');
  assert.equal(leadSourceNode?.deletable, false);

  assert.equal(normalized.edges[0]?.sourceHandle, 'not-interested');
});

test('normalizeFlowData preserves unset mappedStandardFieldKeys as undefined', () => {
  const normalized = normalizeFlowData({
    nodes: [
      {
        id: 'leadSource-1',
        type: 'leadSource',
        position: { x: 0, y: 0 },
        data: {},
      },
    ],
    edges: [],
  });
  const leadSource = normalized.nodes.find((node) => node.type === 'leadSource');
  assert.equal(leadSource?.data.mappedStandardFieldKeys, undefined);
  assert.ok(Array.isArray(leadSource?.data.customFieldKeys));
});

test('normalizeFlowData preserves an explicit mappedStandardFieldKeys array', () => {
  const normalized = normalizeFlowData({
    nodes: [
      {
        id: 'leadSource-1',
        type: 'leadSource',
        position: { x: 0, y: 0 },
        data: { mappedStandardFieldKeys: ['email', 'first_name'] },
      },
    ],
    edges: [],
  });
  const leadSource = normalized.nodes.find((node) => node.type === 'leadSource');
  assert.deepEqual(leadSource?.data.mappedStandardFieldKeys, ['email', 'first_name']);
});

test('normalizeFlowData strips builder lock/UX flags from node and edge data', () => {
  const normalized = normalizeFlowData({
    nodes: [
      {
        id: 'leadSource-1',
        type: 'leadSource',
        position: { x: 0, y: 0 },
        data: {
          structuralBlocked: true,
          canDelete: true,
          readOnly: false,
          customFieldKeys: ['company'],
        },
      },
      {
        id: 'dataSender-1',
        type: 'dataSender',
        position: { x: 100, y: 0 },
        data: {
          structuralBlocked: true,
          canDelete: false,
          endpoint_url: 'https://example.com/hook',
        },
      },
    ],
    edges: [
      {
        id: 'e1',
        source: 'leadSource-1',
        target: 'dataSender-1',
        data: { readOnly: true, structuralBlocked: true },
      },
    ],
  });

  const leadSource = normalized.nodes.find((node) => node.id === 'leadSource-1');
  const dataSender = normalized.nodes.find((node) => node.id === 'dataSender-1');
  assert.equal('structuralBlocked' in (leadSource?.data ?? {}), false);
  assert.equal('canDelete' in (leadSource?.data ?? {}), false);
  assert.equal('readOnly' in (leadSource?.data ?? {}), false);
  assert.deepEqual(leadSource?.data.customFieldKeys, ['company']);
  assert.equal('structuralBlocked' in (dataSender?.data ?? {}), false);
  assert.equal(normalized.edges[0]?.data, undefined);
});

const emailVariant = (id: string, subject: string) => ({
  id,
  subject,
  template: 'Hello',
  isActive: true,
  order: 0,
});

test('normalizeFlowData: downstream email becomes priority by position', () => {
  const normalized = normalizeFlowData({
    nodes: [
      { id: 'leadSource-1', type: 'leadSource', position: { x: 0, y: 0 }, data: {} },
      {
        id: 'email-pre',
        type: 'email',
        position: { x: 100, y: 0 },
        // Stored as priority but sits BEFORE the categorizer -> must heal to false.
        data: {
          label: 'Send Email',
          priority: true,
          variants: [emailVariant('11111111-1111-4111-8111-111111111111', '')],
        },
      },
      { id: 'cat-1', type: 'aiCategorizer', position: { x: 200, y: 0 }, data: {} },
      {
        id: 'email-post',
        type: 'email',
        position: { x: 300, y: 0 },
        // After the categorizer with NO subject -> still priority by position.
        data: {
          label: 'Send Email',
          priority: false,
          variants: [emailVariant('22222222-2222-4222-8222-222222222222', '')],
        },
      },
    ],
    edges: [
      { id: 'e1', source: 'leadSource-1', target: 'email-pre' },
      { id: 'e2', source: 'email-pre', target: 'cat-1' },
      { id: 'e3', source: 'cat-1', target: 'email-post', sourceHandle: 'interested' },
    ],
  });

  const pre = normalized.nodes.find((node) => node.id === 'email-pre');
  const post = normalized.nodes.find((node) => node.id === 'email-post');
  assert.equal((pre?.data as { priority?: boolean }).priority, false);
  assert.equal((post?.data as { priority?: boolean }).priority, true);
});

test('normalizeFlowData: downstream email stays priority even with a subject', () => {
  const normalized = normalizeFlowData({
    nodes: [
      { id: 'leadSource-1', type: 'leadSource', position: { x: 0, y: 0 }, data: {} },
      { id: 'cat-1', type: 'aiCategorizer', position: { x: 100, y: 0 }, data: {} },
      {
        id: 'email-post',
        type: 'email',
        position: { x: 200, y: 0 },
        // Stored as non-priority but lives after the categorizer -> must heal to true.
        data: {
          label: 'Send Email',
          priority: false,
          variants: [emailVariant('33333333-3333-4333-8333-333333333333', 'A fresh idea')],
        },
      },
    ],
    edges: [{ id: 'e1', source: 'cat-1', target: 'email-post', sourceHandle: 'not-interested' }],
  });

  const post = normalized.nodes.find((node) => node.id === 'email-post');
  assert.equal((post?.data as { priority?: boolean }).priority, true);
});

test('normalizeFlowData keeps emails non-priority when no categorizer exists', () => {
  const normalized = normalizeFlowData({
    nodes: [
      { id: 'leadSource-1', type: 'leadSource', position: { x: 0, y: 0 }, data: {} },
      {
        id: 'email-1',
        type: 'email',
        position: { x: 100, y: 0 },
        data: {
          label: 'Send Email',
          priority: true,
          variants: [emailVariant('44444444-4444-4444-8444-444444444444', '')],
        },
      },
    ],
    edges: [{ id: 'e1', source: 'leadSource-1', target: 'email-1' }],
  });

  const email = normalized.nodes.find((node) => node.id === 'email-1');
  assert.equal((email?.data as { priority?: boolean }).priority, false);
});

test('validateFlowData reports merge-variable and variant issues', () => {
  const invalidFlow = clone(CAMPAIGN_FLOW_EXAMPLE_LINEAR);
  const emailNode = invalidFlow.nodes.find((node) => node.id === 'email-1');
  assert.ok(emailNode && emailNode.type === 'email');
  if (!emailNode || emailNode.type !== 'email') {
    throw new Error('email node missing from example flow');
  }
  emailNode.data.variants[0]!.id = 'not-a-uuid';
  emailNode.data.variants[0]!.subject = 'Hello {{custom.missing}}';

  const result = validateFlowData(invalidFlow);
  assert.equal(result.issues.some((issue) => issue.code === 'invalid_variant_id'), true);
  assert.equal(result.issues.some((issue) => issue.code === 'unknown_merge_variable'), true);
});

test('validateForPhase treats all issues as draft warnings and launch blockers', () => {
  const invalidFlow = clone(CAMPAIGN_FLOW_EXAMPLE_LINEAR);
  const emailNode = invalidFlow.nodes.find((node) => node.id === 'email-1');
  assert.ok(emailNode && emailNode.type === 'email');
  if (!emailNode || emailNode.type !== 'email') {
    throw new Error('email node missing from example flow');
  }
  emailNode.data.variants[0]!.subject = 'Hello {{custom.missing}}';

  const draft = validateForPhase(invalidFlow, 'draft');
  assert.equal(draft.blockingIssues.length, 0);
  assert.ok(draft.warnings.some((issue) => issue.code === 'unknown_merge_variable'));

  const launch = validateForPhase(invalidFlow, 'launch');
  assert.ok(launch.blockingIssues.some((issue) => issue.code === 'unknown_merge_variable'));
  assert.equal(launch.warnings.length, 0);
});

test('classifyFlowChange distinguishes content and structural edits', () => {
  const original = clone(CAMPAIGN_FLOW_EXAMPLE_LINEAR);

  const contentEdit = clone(original);
  const contentEmail = contentEdit.nodes.find((node) => node.id === 'email-1');
  assert.ok(contentEmail && contentEmail.type === 'email');
  if (!contentEmail || contentEmail.type !== 'email') {
    throw new Error('email node missing from example flow');
  }
  contentEmail.data.variants[0]!.subject = 'Updated subject';
  assert.equal(classifyFlowChange(original, contentEdit).kind, 'content');

  const addVariantEdit = clone(original);
  const addVariantEmail = addVariantEdit.nodes.find((node) => node.id === 'email-1');
  assert.ok(addVariantEmail && addVariantEmail.type === 'email');
  if (!addVariantEmail || addVariantEmail.type !== 'email') {
    throw new Error('email node missing from example flow');
  }
  addVariantEmail.data.variants.push({
    id: '55555555-5555-4555-8555-555555555555',
    label: 'C',
    subject: 'Third option',
    template: 'Third body',
    isActive: true,
    order: 2,
  });
  assert.equal(classifyFlowChange(original, addVariantEdit).kind, 'content');

  const structuralEdit = clone(original);
  structuralEdit.edges.pop();
  assert.equal(classifyFlowChange(original, structuralEdit).kind, 'structural');
});

test('assertFlowEditAllowed blocks structural edits while running', () => {
  assert.equal(assertFlowEditAllowed('draft', 'structural').allowed, true);
  assert.equal(assertFlowEditAllowed('paused', 'structural').allowed, true);
  assert.equal(assertFlowEditAllowed('running', 'content').allowed, true);

  const policy = assertFlowEditAllowed('running', 'structural');
  assert.equal(policy.allowed, false);
  assert.equal(policy.code, 'flow_locked');
});
