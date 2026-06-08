import assert from 'node:assert';
import { describe, it } from 'node:test';
import { getViewSelectAllState } from './viewSelectAllState';

describe('getViewSelectAllState', () => {
  it('returns unchecked state when selection is disabled', () => {
    const state = getViewSelectAllState({
      selectable: false,
      selectedKeys: new Set(['a']),
      scopeKeys: ['a'],
      selectAllScope: 'all',
      isServerPagination: false,
    });

    assert.deepStrictEqual(state, { allSelected: false, someSelected: false });
  });

  it('marks client-side selection as fully selected when every scoped key is selected', () => {
    const state = getViewSelectAllState({
      selectable: true,
      selectedKeys: new Set(['a', 'b']),
      scopeKeys: ['a', 'b'],
      selectAllScope: 'all',
      isServerPagination: false,
    });

    assert.deepStrictEqual(state, { allSelected: true, someSelected: false });
  });

  it('marks client-side selection as partial when only some scoped keys are selected', () => {
    const state = getViewSelectAllState({
      selectable: true,
      selectedKeys: new Set(['a']),
      scopeKeys: ['a', 'b'],
      selectAllScope: 'page',
      isServerPagination: false,
    });

    assert.deepStrictEqual(state, { allSelected: false, someSelected: true });
  });

  it('marks server-side view selection as fully selected only when the whole view is selected', () => {
    const state = getViewSelectAllState({
      selectable: true,
      selectedKeys: new Set(['a', 'b', 'c']),
      scopeKeys: ['a', 'b'],
      selectAllScope: 'all',
      isServerPagination: true,
      totalItems: 3,
    });

    assert.deepStrictEqual(state, { allSelected: true, someSelected: false });
  });

  it('keeps server-side view selection indeterminate when only part of the filtered view is selected', () => {
    const state = getViewSelectAllState({
      selectable: true,
      selectedKeys: new Set(['a', 'b']),
      scopeKeys: ['a', 'b'],
      selectAllScope: 'all',
      isServerPagination: true,
      totalItems: 5,
    });

    assert.deepStrictEqual(state, { allSelected: false, someSelected: true });
  });

  it('keeps server-side view selection indeterminate when selected rows are off the current page', () => {
    const state = getViewSelectAllState({
      selectable: true,
      selectedKeys: new Set(['c']),
      scopeKeys: ['a', 'b'],
      selectAllScope: 'all',
      isServerPagination: true,
      totalItems: 5,
    });

    assert.deepStrictEqual(state, { allSelected: false, someSelected: true });
  });
});
