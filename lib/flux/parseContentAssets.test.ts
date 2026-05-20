import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { parseContentAssets } from './parseContentAssets';

describe('parseContentAssets', () => {
  test('parses valid case study rows', () => {
    const assets = parseContentAssets([
      {
        id: 'cs-1',
        type: 'case_study',
        title: 'Acme',
        body: 'Grew revenue.',
        metric: '2x',
        imageUrl: 'https://cdn.example/a.jpg',
      },
    ]);
    assert.equal(assets.length, 1);
    assert.equal(assets[0]?.id, 'cs-1');
    assert.equal(assets[0]?.metric, '2x');
    assert.equal(assets[0]?.imageUrl, 'https://cdn.example/a.jpg');
  });

  test('ignores invalid rows', () => {
    assert.deepEqual(parseContentAssets([{ id: 'x', type: 'case_study' }]), []);
    assert.deepEqual(parseContentAssets(null), []);
  });
});
