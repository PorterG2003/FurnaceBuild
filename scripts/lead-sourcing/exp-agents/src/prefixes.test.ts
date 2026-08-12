import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  defaultTwoLetterPrefixes,
  deepenPrefix,
  enqueueAfterPrefix,
  shouldDeepen,
} from './prefixes.ts';

describe('prefixes', () => {
  it('defaultTwoLetterPrefixes has 676 entries starting aa ending zz', () => {
    const all = defaultTwoLetterPrefixes();
    assert.equal(all.length, 676);
    assert.equal(all[0], 'aa');
    assert.equal(all[all.length - 1], 'zz');
  });

  it('deepenPrefix appends a-z', () => {
    assert.deepEqual(deepenPrefix('aa').slice(0, 3), ['aaa', 'aab', 'aac']);
    assert.equal(deepenPrefix('aa').length, 26);
  });

  it('deepenPrefix prioritizes next letters from names', () => {
    const deep = deepenPrefix('aa', ['Aamar Blair', 'Aaron Johnson']);
    assert.equal(deep[0], 'aam');
    assert.equal(deep[1], 'aar');
    assert.equal(deep.length, 26);
  });

  it('shouldDeepen at cap', () => {
    assert.equal(shouldDeepen(65), true);
    assert.equal(shouldDeepen(64), false);
  });

  it('enqueueAfterPrefix deepens when capped', () => {
    const completed = new Set<string>(['aa']);
    const queue = enqueueAfterPrefix({
      prefix: 'aa',
      suggestionCount: 65,
      queue: ['ab', 'ac'],
      completed,
    });
    // Deepen children are appended after remaining seeds (breadth-first).
    assert.equal(queue[0], 'ab');
    assert.equal(queue[1], 'ac');
    assert.ok(queue.includes('aaa'));
    assert.ok(queue.includes('aaz'));
    assert.ok(!queue.includes('aa'));
  });

  it('enqueueAfterPrefix does not deepen under cap', () => {
    const queue = enqueueAfterPrefix({
      prefix: 'zq',
      suggestionCount: 0,
      queue: ['zr'],
      completed: new Set(['zq']),
    });
    assert.deepEqual(queue, ['zr']);
  });
});
