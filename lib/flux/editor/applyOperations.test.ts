import test from 'node:test';
import assert from 'node:assert/strict';
import { applyFluxEditorOperations } from './applyOperations.js';
import type { FluxEditorDocumentState } from './applyOperations.js';
import { defaultFluxPreviewProspect } from '../fluxCampaignPreview.js';
import type { Block } from '../types.js';
import { emptyFluxSellerProfile } from '../campaignSeller.js';
import { defaultFluxBrandingPolicy } from '../fluxBrandingPolicy.js';

function baseDoc(): FluxEditorDocumentState {
  return {
    name: 'Campaign',
    offerDescription: '',
    blocks: [] as Block[],
    contentAssets: [],
    copySlots: 'headline',
    constraints: '',
    previewProspect: defaultFluxPreviewProspect(),
    sellerProfile: emptyFluxSellerProfile(),
    brandingPolicy: defaultFluxBrandingPolicy(),
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

test('block.add quiz_and_book creates default configurable quiz props', () => {
  let s = baseDoc();
  s = applyFluxEditorOperations(s, [{ type: 'block.add', blockType: 'quiz_and_book' }]);
  assert.equal(s.blocks.length, 1);
  const block = s.blocks[0];
  assert.equal(block?.type, 'quiz_and_book');
  if (block?.type === 'quiz_and_book') {
    assert.equal(block.props.questions.length, 1);
    assert.ok(block.props.calendlyUrl.includes('calendly.com'));
  }
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

test('block.setScrollTag sets and clears scrollTag', () => {
  const hero: Block = {
    id: 'a',
    type: 'hero',
    order: 0,
    props: { headline: 'A', subheadline: '', ctaText: 'x', ctaUrl: 'https://example.com' },
  };
  let s = { ...baseDoc(), blocks: [hero] };
  s = applyFluxEditorOperations(s, [{ type: 'block.setScrollTag', blockId: 'a', scrollTag: 'hero-top' }]);
  assert.equal(s.blocks[0].scrollTag, 'hero-top');
  s = applyFluxEditorOperations(s, [{ type: 'block.setScrollTag', blockId: 'a', scrollTag: null }]);
  assert.equal(s.blocks[0].scrollTag, undefined);
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
