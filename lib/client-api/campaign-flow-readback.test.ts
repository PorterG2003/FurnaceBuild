import assert from 'node:assert/strict';
import test from 'node:test';
import { enrichFlowForApiReadback, withLeadSourceBucketId } from './campaign-flow-readback.js';

test('withLeadSourceBucketId sets lead source bucketId', () => {
  const flow = withLeadSourceBucketId(
    {
      nodes: [
        { id: 'ls', type: 'leadSource', position: { x: 0, y: 0 }, data: { label: 'Leads' } },
        { id: 'e1', type: 'email', position: { x: 0, y: 0 }, data: { variants: [] } },
      ],
      edges: [],
    },
    'bucket-1',
  );
  assert.equal((flow.nodes[0].data as { bucketId?: string }).bucketId, 'bucket-1');
});

test('enrichFlowForApiReadback fills richText body_html from template', () => {
  const flow = enrichFlowForApiReadback({
    nodes: [
      {
        id: 'e1',
        type: 'email',
        position: { x: 0, y: 0 },
        data: {
          variants: [
            {
              id: 'v1',
              editor_mode: 'richText',
              subject: 'Hi',
              template: 'Hello {{first_name}}',
              body_text: 'Hello {{first_name}}',
              body_html: '',
            },
          ],
        },
      },
    ],
    edges: [],
  });
  const variant = (flow.nodes[0].data as { variants: Array<{ body_html: string }> }).variants[0];
  assert.ok(variant.body_html.includes('Hello'));
});
