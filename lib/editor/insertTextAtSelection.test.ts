import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { insertTextAtSelection } from './insertTextAtSelection.js';

describe('insertTextAtSelection', () => {
  it('inserts at cursor position', () => {
    const result = insertTextAtSelection('hello world', { start: 5, end: 5 }, ' beautiful');

    assert.equal(result.text, 'hello beautiful world');
    assert.deepEqual(result.selection, { start: 15, end: 15 });
  });

  it('replaces selected range', () => {
    const result = insertTextAtSelection('hello world', { start: 6, end: 11 }, 'there');

    assert.equal(result.text, 'hello there');
    assert.deepEqual(result.selection, { start: 11, end: 11 });
  });

  it('inserts at start of empty string', () => {
    const result = insertTextAtSelection('', { start: 0, end: 0 }, '{{email}}');

    assert.equal(result.text, '{{email}}');
    assert.deepEqual(result.selection, { start: 9, end: 9 });
  });
});
