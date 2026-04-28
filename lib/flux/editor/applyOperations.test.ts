import test from 'node:test';
import assert from 'node:assert/strict';
import { applyFluxEditorOperations } from './applyOperations.js';
import { defaultFluxPreviewProspect } from '../fluxCampaignPreview.js';
import type { Block } from '../types.js';

function baseDoc() {
  return {
    name: 'Campaign',
    offerDescription: '',
    blocks: [] as Block[],
    contentAssets: [],
    copySlots: 'headline',
    constraints: '',
    previewProspect: defaultFluxPreviewProspect(),
    editingBlockId: null as string | null,
  };
}

test('applyFluxEditorOperations sets name and adds block', () => {
  let s = baseDoc();
  s = applyFluxEditorOperations(s, [
    { type: 'campaign.setName', value: 'Renamed' },
    { type: 'block.add', blockType: 'hero' },
  ]);
  assert.equal(s.name, 'Renamed');
  assert.equal(s.blocks.length, 1);
  assert.equal(s.blocks[0].type, 'hero');
  assert.equal(s.editingBlockId, s.blocks[0].id);
});

test('block.reorder reindexes orders', () => {
  const a: Block = {
    id: 'a',
    type: 'hero',
    order: 0,
    props: { headline: 'A', subheadline: '', ctaText: 'x', ctaUrl: '' },
  };
  const b: Block = {
    id: 'b',
    type: 'cta',
    order: 1,
    props: { headline: 'B', ctaText: 'y', ctaUrl: '' },
  };
  let s = { ...baseDoc(), blocks: [a, b] };
  s = applyFluxEditorOperations(s, [{ type: 'block.reorder', blockIds: ['b', 'a'] }]);
  assert.equal(s.blocks[0].id, 'b');
  assert.equal(s.blocks[0].order, 0);
  assert.equal(s.blocks[1].id, 'a');
  assert.equal(s.blocks[1].order, 1);
});

test('asset.update patches fields on matching asset', () => {
  let s = {
    ...baseDoc(),
    contentAssets: [
      {
        id: 'x',
        type: 'case_study' as const,
        title: 'Old',
        body: 'B',
        metric: 'm',
      },
    ],
  };
  s = applyFluxEditorOperations(s, [
    {
      type: 'asset.update',
      assetId: 'x',
      patch: { title: 'New', metric: null, imageUrl: 'https://img' },
    },
  ]);
  assert.equal(s.contentAssets[0].title, 'New');
  assert.equal(s.contentAssets[0].metric, undefined);
  assert.equal(s.contentAssets[0].imageUrl, 'https://img');
});
