import assert from 'node:assert/strict';
import test from 'node:test';
import { CAMPAIGN_FLOW_EXAMPLE_LINEAR } from './examples.js';
import { classifyFlowChange, detectFlowAppend } from './diff.js';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

test('detectFlowAppend finds former leaves that gained an outgoing edge', () => {
  const original = clone(CAMPAIGN_FLOW_EXAMPLE_LINEAR);
  const appended = clone(original);
  appended.nodes.push({
    id: 'email-3',
    type: 'email',
    position: { x: 940, y: 0 },
    data: {
      label: 'Extra follow up',
      variants: [{
        id: '66666666-6666-4666-8666-666666666666',
        label: 'A',
        subject: 'Follow up',
        template: 'Body',
        isActive: true,
        order: 0,
      }],
    },
  });
  appended.edges.push({
    id: 'e-append',
    source: 'email-2',
    target: 'email-3',
  });

  assert.deepEqual(detectFlowAppend(original, appended).extendedFlowNodeIds, ['email-2']);
});

test('detectFlowAppend ignores insert-in-middle and rewire-only changes', () => {
  const original = clone(CAMPAIGN_FLOW_EXAMPLE_LINEAR);
  const middleInsert = clone(original);
  middleInsert.nodes.push({
    id: 'wait-2',
    type: 'waitTime',
    position: { x: 580, y: 0 },
    data: { duration: '1', unit: 'days', wait_duration_seconds: 86400 },
  });
  middleInsert.edges = [
    { id: 'e1', source: 'leadSource-1', target: 'email-1' },
    { id: 'e2', source: 'email-1', target: 'waitTime-1' },
    { id: 'e3', source: 'waitTime-1', target: 'wait-2' },
    { id: 'e4', source: 'wait-2', target: 'email-2' },
  ];
  assert.deepEqual(detectFlowAppend(original, middleInsert).extendedFlowNodeIds, []);

  const rewire = clone(original);
  rewire.edges = [
    { id: 'e1', source: 'leadSource-1', target: 'waitTime-1' },
    { id: 'e2', source: 'waitTime-1', target: 'email-1' },
    { id: 'e3', source: 'email-1', target: 'email-2' },
  ];
  assert.deepEqual(detectFlowAppend(original, rewire).extendedFlowNodeIds, []);
});

test('classifyFlowChange and detectFlowAppend share append semantics', () => {
  const original = clone(CAMPAIGN_FLOW_EXAMPLE_LINEAR);
  const appended = clone(original);
  appended.nodes.push({
    id: 'email-3',
    type: 'email',
    position: { x: 940, y: 0 },
    data: {
      label: 'Extra follow up',
      variants: [{
        id: '77777777-7777-4777-8777-777777777777',
        label: 'A',
        subject: 'Follow up',
        template: 'Body',
        isActive: true,
        order: 0,
      }],
    },
  });
  appended.edges.push({ id: 'e-append', source: 'email-2', target: 'email-3' });

  assert.equal(classifyFlowChange(original, appended).kind, 'structural');
  assert.ok(detectFlowAppend(original, appended).extendedFlowNodeIds.includes('email-2'));
});
