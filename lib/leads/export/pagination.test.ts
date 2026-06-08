import assert from 'node:assert/strict';
import test from 'node:test';
import { SAVED_LIST_PAGE_MAX } from './constants';
import { shouldContinueOffsetPagination, shouldContinueSavedListExportPagination } from './pagination';

test('shouldContinueSavedListExportPagination continues after a full saved-list page', () => {
  assert.equal(SAVED_LIST_PAGE_MAX, 500);
  assert.equal(shouldContinueSavedListExportPagination(SAVED_LIST_PAGE_MAX), true);
});

test('shouldContinueOffsetPagination shows why a stale 1000-row page size stops early', () => {
  assert.equal(shouldContinueOffsetPagination(500, 1000), false);
});

test('shouldContinueSavedListExportPagination stops after a short saved-list page', () => {
  assert.equal(shouldContinueSavedListExportPagination(200), false);
  assert.equal(shouldContinueSavedListExportPagination(0), false);
});
