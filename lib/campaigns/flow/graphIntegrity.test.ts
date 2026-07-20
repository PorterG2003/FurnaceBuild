import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deriveEmailPriority,
  edgesToRemoveForDeletedNodeIds,
  flowNeedsOrphanEdgeHeal,
  nodeIdsDownstreamOfCategorizer,
  pruneOrphanEdges,
} from './graphIntegrity.js';
import { normalizeFlowData } from './normalize.js';

test('pruneOrphanEdges keeps only edges with live endpoints', () => {
  const kept = pruneOrphanEdges(
    [
      { id: 'e1', source: 'a', target: 'b' },
      { id: 'e2', source: 'a', target: 'missing' },
      { id: 'e3', source: 'gone', target: 'b' },
    ],
    new Set(['a', 'b']),
  );
  assert.deepEqual(kept.map((edge) => edge.id), ['e1']);
});

test('edgesToRemoveForDeletedNodeIds returns incident edge ids', () => {
  assert.deepEqual(
    edgesToRemoveForDeletedNodeIds(
      [
        { id: 'e1', source: 'a', target: 'b' },
        { id: 'e2', source: 'b', target: 'c' },
        { id: 'e3', source: 'c', target: 'd' },
      ],
      ['b'],
    ),
    ['e1', 'e2'],
  );
});

test('flowNeedsOrphanEdgeHeal detects raw orphans vs sanitized', () => {
  const raw = {
    nodes: [{ id: 'a' }, { id: 'b' }],
    edges: [
      { id: 'e1', source: 'a', target: 'b' },
      { id: 'e2', source: 'a', target: 'missing' },
    ],
  };
  const sanitized = normalizeFlowData(raw);
  assert.equal(sanitized.edges.length, 1);
  assert.equal(flowNeedsOrphanEdgeHeal(raw, sanitized), true);
  assert.equal(flowNeedsOrphanEdgeHeal(sanitized, sanitized), false);
});

test('deriveEmailPriority marks only downstream emails as priority', () => {
  const nodes = [
    { id: 'leadSource-1', type: 'leadSource' },
    { id: 'email-1', type: 'email' },
    { id: 'aiCategorizer-1', type: 'aiCategorizer' },
    { id: 'email-2', type: 'email' },
  ];
  const edges = [
    { source: 'leadSource-1', target: 'email-1' },
    { source: 'email-1', target: 'aiCategorizer-1' },
    { source: 'aiCategorizer-1', target: 'email-2' },
  ];
  const downstream = nodeIdsDownstreamOfCategorizer(nodes, edges);

  assert.equal(deriveEmailPriority(nodes[1]!, downstream), false);
  assert.equal(deriveEmailPriority(nodes[3]!, downstream), true);
});

test('normalizeFlowData drops orphan edges and keeps categorizer handle backfill', () => {
  const normalized = normalizeFlowData({
    nodes: [
      {
        id: 'aiCategorizer-1',
        type: 'aiCategorizer',
        position: { x: 0, y: 0 },
        data: {},
      },
      {
        id: 'email-1',
        type: 'email',
        position: { x: 10, y: 0 },
        data: {
          variants: [
            {
              id: '11111111-1111-4111-8111-111111111111',
              label: 'A',
              subject: 'Hi',
              template: 'Body',
              isActive: true,
              order: 0,
            },
          ],
        },
      },
    ],
    edges: [
      {
        id: 'edge-aiCategorizer-1not-interested-email-1',
        source: 'aiCategorizer-1',
        target: 'email-1',
      },
      {
        id: 'edge-orphan',
        source: 'aiCategorizer-1',
        target: 'deleted-node',
      },
    ],
  });

  assert.equal(normalized.edges.length, 1);
  assert.equal(normalized.edges[0]?.source, 'aiCategorizer-1');
  assert.equal(normalized.edges[0]?.target, 'email-1');
  assert.equal(normalized.edges[0]?.sourceHandle, 'not-interested');
});
