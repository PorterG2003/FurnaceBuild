import assert from 'node:assert/strict';
import test from 'node:test';
import { CAMPAIGN_FLOW_EXAMPLE_LINEAR } from './examples.js';
import { computeFlowRevision, canonicalizeFlowForRevision, stableSerializeFlow } from './revision.js';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Simulate a Postgres jsonb round-trip, which returns object keys in a different order. */
function reorderKeys<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(reorderKeys) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const reordered: Record<string, unknown> = {};
    for (const key of Object.keys(record).reverse()) {
      reordered[key] = reorderKeys(record[key]);
    }
    return reordered as T;
  }
  return value;
}

test('computeFlowRevision is stable when object keys are reordered', async () => {
  const flowA = clone(CAMPAIGN_FLOW_EXAMPLE_LINEAR);
  const flowB = clone(CAMPAIGN_FLOW_EXAMPLE_LINEAR);
  const emailNode = flowB.nodes.find((node) => node.id === 'email-1');
  assert.ok(emailNode && emailNode.type === 'email');
  if (!emailNode || emailNode.type !== 'email') throw new Error('missing email');
  const variant = emailNode.data.variants[0]!;
  emailNode.data.variants[0] = {
    template: variant.template,
    subject: variant.subject,
    id: variant.id,
    label: variant.label,
    isActive: variant.isActive,
    order: variant.order,
  };
  assert.equal(await computeFlowRevision(flowA), await computeFlowRevision(flowB));
});

test('computeFlowRevision ignores UI-only node fields', async () => {
  const base = clone(CAMPAIGN_FLOW_EXAMPLE_LINEAR);
  const withUi = clone(CAMPAIGN_FLOW_EXAMPLE_LINEAR);
  withUi.nodes = withUi.nodes.map((node, index) => ({
    ...node,
    position: { x: index * 100, y: index * 50 },
    selected: index === 0,
  }));
  assert.equal(
    await computeFlowRevision(canonicalizeFlowForRevision(base)),
    await computeFlowRevision(canonicalizeFlowForRevision(withUi)),
  );
});

test('computeFlowRevision changes when normalized content changes', async () => {
  const base = clone(CAMPAIGN_FLOW_EXAMPLE_LINEAR);
  const edited = clone(CAMPAIGN_FLOW_EXAMPLE_LINEAR);
  const emailNode = edited.nodes.find((node) => node.id === 'email-1');
  assert.ok(emailNode && emailNode.type === 'email');
  if (!emailNode || emailNode.type !== 'email') throw new Error('missing email node');
  emailNode.data.variants[0]!.subject = 'Different subject';
  assert.notEqual(await computeFlowRevision(base), await computeFlowRevision(edited));
});

test('stableSerializeFlow is invariant to object key order (jsonb round-trip)', () => {
  const flow = clone(CAMPAIGN_FLOW_EXAMPLE_LINEAR);
  const roundTripped = reorderKeys(clone(CAMPAIGN_FLOW_EXAMPLE_LINEAR));
  assert.equal(stableSerializeFlow(flow), stableSerializeFlow(roundTripped));
});

test('stableSerializeFlow still changes when node position changes', () => {
  const base = clone(CAMPAIGN_FLOW_EXAMPLE_LINEAR);
  const moved = clone(CAMPAIGN_FLOW_EXAMPLE_LINEAR);
  moved.nodes[0]!.position = { x: 999, y: 999 };
  assert.notEqual(stableSerializeFlow(base), stableSerializeFlow(moved));
});

test('stableSerializeFlow still changes when node data changes', () => {
  const base = clone(CAMPAIGN_FLOW_EXAMPLE_LINEAR);
  const edited = clone(CAMPAIGN_FLOW_EXAMPLE_LINEAR);
  const emailNode = edited.nodes.find((node) => node.id === 'email-1');
  assert.ok(emailNode && emailNode.type === 'email');
  if (!emailNode || emailNode.type !== 'email') throw new Error('missing email node');
  emailNode.data.variants[0]!.subject = 'Different subject';
  assert.notEqual(stableSerializeFlow(base), stableSerializeFlow(edited));
});
