import test from 'node:test';
import assert from 'node:assert/strict';
import { getEmailNodesInSendOrder } from './emailNodeSendOrder';

test('getEmailNodesInSendOrder sorts linear email steps by send sequence, not raw graph depth', () => {
  const ordered = getEmailNodesInSendOrder({
    nodes: [
      { id: 'lead-1', type: 'leadSource', position: { x: 0, y: 0 } },
      { id: 'wait-1', type: 'waitTime', position: { x: 100, y: 0 } },
      { id: 'email-2', type: 'email', position: { x: 300, y: 0 } },
      { id: 'email-1', type: 'email', position: { x: 100, y: 100 } },
      { id: 'wait-2', type: 'waitTime', position: { x: 200, y: 100 } },
    ],
    edges: [
      { source: 'lead-1', target: 'email-1' },
      { source: 'email-1', target: 'wait-2' },
      { source: 'wait-2', target: 'email-2' },
      { source: 'lead-1', target: 'wait-1' },
    ],
  });

  assert.deepEqual(
    ordered.map((node) => node.id),
    ['email-1', 'email-2'],
  );
});

test('getEmailNodesInSendOrder keeps same-stage branch emails in layout order', () => {
  const ordered = getEmailNodesInSendOrder({
    nodes: [
      { id: 'lead-1', type: 'leadSource', position: { x: 0, y: 0 } },
      { id: 'email-right', type: 'email', position: { x: 300, y: 0 } },
      { id: 'email-left', type: 'email', position: { x: 100, y: 50 } },
      { id: 'email-lower', type: 'email', position: { x: 100, y: 150 } },
    ],
    edges: [
      { source: 'lead-1', target: 'email-right' },
      { source: 'lead-1', target: 'email-lower' },
      { source: 'lead-1', target: 'email-left' },
    ],
  });

  assert.deepEqual(
    ordered.map((node) => node.id),
    ['email-left', 'email-lower', 'email-right'],
  );
});

test('getEmailNodesInSendOrder falls back to indegree roots when leadSource is missing', () => {
  const ordered = getEmailNodesInSendOrder({
    nodes: [
      { id: 'email-2', type: 'email', position: { x: 200, y: 0 } },
      { id: 'wait-1', type: 'waitTime', position: { x: 100, y: 0 } },
      { id: 'email-1', type: 'email', position: { x: 0, y: 0 } },
    ],
    edges: [
      { source: 'email-1', target: 'wait-1' },
      { source: 'wait-1', target: 'email-2' },
    ],
  });

  assert.deepEqual(
    ordered.map((node) => node.id),
    ['email-1', 'email-2'],
  );
});
