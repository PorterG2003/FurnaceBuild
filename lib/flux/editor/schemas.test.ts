import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseFluxEditorOperations,
  fluxEditorChatResponseSchema,
  blockTypeSchema,
  FLUX_EDITOR_CHAT_BLOCK_ADD_TYPE_ALTS,
  coerceFluxEditorOperationsArray,
} from './schemas.js';

test('parseFluxEditorOperations accepts block.add competitor_ad_audit', () => {
  const r = parseFluxEditorOperations([{ type: 'block.add', blockType: 'competitor_ad_audit' }]);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.operations[0]?.type, 'block.add');
});

test('parseFluxEditorOperations accepts block.add quiz_and_book', () => {
  const r = parseFluxEditorOperations([{ type: 'block.add', blockType: 'quiz_and_book' }]);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.operations[0]?.type, 'block.add');
});

test('FLUX_EDITOR_CHAT_BLOCK_ADD_TYPE_ALTS lists every blockTypeSchema value', () => {
  const expected = blockTypeSchema.options.map((t) => `"${t}"`).join('|');
  assert.equal(FLUX_EDITOR_CHAT_BLOCK_ADD_TYPE_ALTS, expected);
});

test('coerceFluxEditorOperationsArray drops bare strings and keeps objects', () => {
  const coerced = coerceFluxEditorOperationsArray([
    { type: 'block.remove', blockId: 'a' },
    'not-json',
    42,
    null,
    { type: 'campaign.setName', value: 'X' },
  ]);
  assert.equal(coerced.length, 2);
  assert.deepEqual(coerced[0], { type: 'block.remove', blockId: 'a' });
  assert.deepEqual(coerced[1], { type: 'campaign.setName', value: 'X' });
});

test('coerceFluxEditorOperationsArray parses stringified operation objects', () => {
  const coerced = coerceFluxEditorOperationsArray([
    '{"type":"block.remove","blockId":"z1"}',
    { type: 'campaign.setName', value: 'Y' },
  ]);
  assert.equal(coerced.length, 2);
  assert.deepEqual(coerced[0], { type: 'block.remove', blockId: 'z1' });
});

test('fluxEditorChatResponseSchema tolerates string junk in operations array', () => {
  const r = fluxEditorChatResponseSchema.safeParse({
    assistantMessage: 'Done.',
    operations: [
      { type: 'campaign.setName', value: 'Acme' },
      'summary line mistakenly here',
      { type: 'campaign.setOfferDescription', value: 'Offer' },
    ],
  });
  assert.equal(r.success, true);
  if (r.success) {
    assert.equal(r.data.operations.length, 2);
    assert.equal(r.data.operations[0]?.type, 'campaign.setName');
    assert.equal(r.data.operations[1]?.type, 'campaign.setOfferDescription');
  }
});

test('parseFluxEditorOperations accepts valid ops', () => {
  const r = parseFluxEditorOperations([
    { type: 'campaign.setName', value: 'X' },
    { type: 'block.remove', blockId: 'abc' },
    {
      type: 'asset.update',
      assetId: 'a1',
      patch: { title: 'T', imageUrl: 'https://x.example/logo.png' },
    },
  ]);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.operations.length, 3);
});

test('parseFluxEditorOperations rejects invalid op', () => {
  const r = parseFluxEditorOperations([{ type: 'campaign.setName', value: 1 }]);
  assert.equal(r.ok, false);
});

test('fluxEditorChatResponseSchema parses assistant payload', () => {
  const z = fluxEditorChatResponseSchema.safeParse({
    assistantMessage: 'Done.',
    operations: [],
    summary: ['Updated name'],
    requiresAiPreview: false,
  });
  assert.equal(z.success, true);
});
