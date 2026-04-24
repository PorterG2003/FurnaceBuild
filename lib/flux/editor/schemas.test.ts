import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFluxEditorOperations, fluxEditorChatResponseSchema } from './schemas.js';

test('parseFluxEditorOperations accepts valid ops', () => {
  const r = parseFluxEditorOperations([
    { type: 'campaign.setName', value: 'X' },
    { type: 'block.remove', blockId: 'abc' },
  ]);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.operations.length, 2);
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
