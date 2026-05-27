import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bulkScopeFromCampaignList,
  bulkScopeFromListMembership,
  isExplorerViewScope,
  isSavedListAllScope,
  isSelectionScope,
} from './bulkScope';

test('bulkScopeFromListMembership maps selection scope', () => {
  const scope = bulkScopeFromListMembership('selection', { globalLeadIds: ['a', 'b'] });
  assert.equal(scope.kind, 'selection');
  if (scope.kind === 'selection') {
    assert.deepEqual(scope.globalLeadIds, ['a', 'b']);
  }
});

test('bulkScopeFromListMembership maps explorer view scope', () => {
  const scope = bulkScopeFromListMembership('explorerView', {
    explorerQuery: { searchQuery: 'acme' },
  });
  assert.equal(scope.kind, 'explorerView');
  assert.ok(isExplorerViewScope(scope));
});

test('bulkScopeFromListMembership maps list-all scope', () => {
  const scope = bulkScopeFromListMembership('listAll', { listId: 'list-1' });
  assert.ok(isSavedListAllScope(scope));
  if (scope.kind === 'savedListAll') {
    assert.equal(scope.listId, 'list-1');
  }
});

test('bulkScopeFromListMembership maps filtered list scope', () => {
  const scope = bulkScopeFromListMembership('listFiltered', {
    listId: 'list-1',
    listPeopleQuery: { replyStatuses: ['has_reply'] },
  });
  assert.equal(scope.kind, 'savedListFiltered');
});

test('bulkScopeFromCampaignList uses saved list when list id is set', () => {
  const scope = bulkScopeFromCampaignList('list-1', ['ignored']);
  assert.ok(isSavedListAllScope(scope));
});

test('bulkScopeFromCampaignList uses selection when no list id', () => {
  const scope = bulkScopeFromCampaignList(null, ['lead-1']);
  assert.ok(isSelectionScope(scope));
});
