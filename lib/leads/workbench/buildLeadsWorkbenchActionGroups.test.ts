import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLeadsWorkbenchActionGroups,
  buildLeadsWorkbenchScopeLabel,
} from './buildLeadsWorkbenchActionGroups';

const noop = () => {};

const selectionHandlers = {
  onAddToCampaign: noop,
  onAddToList: noop,
  onRemoveFromList: noop,
  onPause: noop,
  onResume: noop,
  onRemoveFromCampaigns: noop,
};

function itemKeys(groups: ReturnType<typeof buildLeadsWorkbenchActionGroups>) {
  return groups.map((group) => ({
    id: group.id,
    items: group.items.map((item) => item.key),
  }));
}

test('explorerSelection includes campaigns, lists with create, and enrollment', () => {
  const groups = buildLeadsWorkbenchActionGroups({
    kind: 'explorerSelection',
    selectedCount: 3,
    onCreateListFromSelection: noop,
    ...selectionHandlers,
  });
  assert.deepEqual(itemKeys(groups), [
    { id: 'campaigns', items: ['add-to-campaign', 'remove-from-campaigns'] },
    {
      id: 'lists',
      items: ['add-to-list', 'remove-from-list', 'create-list-from-selection'],
    },
    { id: 'enrollment', items: ['pause', 'resume'] },
  ]);
});

test('listSelection omits create list from selection', () => {
  const groups = buildLeadsWorkbenchActionGroups({
    kind: 'listSelection',
    selectedCount: 2,
    ...selectionHandlers,
  });
  assert.deepEqual(itemKeys(groups), [
    { id: 'campaigns', items: ['add-to-campaign', 'remove-from-campaigns'] },
    { id: 'lists', items: ['add-to-list', 'remove-from-list'] },
    { id: 'enrollment', items: ['pause', 'resume'] },
  ]);
});

test('explorerView only includes list view actions', () => {
  const groups = buildLeadsWorkbenchActionGroups({
    kind: 'explorerView',
    matchingCount: 100,
    onSaveViewAsList: noop,
    onAddViewToList: noop,
    onRemoveViewFromList: noop,
  });
  assert.deepEqual(itemKeys(groups), [
    {
      id: 'lists',
      items: ['save-view-as-list', 'add-view-to-list', 'remove-view-from-list'],
    },
  ]);
});

test('listView uses remove all when no active filters', () => {
  const groups = buildLeadsWorkbenchActionGroups({
    kind: 'listView',
    leadCount: 50,
    filteredCount: 50,
    hasActiveFilters: false,
    onAddAllToCampaign: noop,
    onRemoveAllFromList: noop,
  });
  assert.deepEqual(itemKeys(groups), [
    { id: 'campaigns', items: ['add-all-to-campaign'] },
    { id: 'lists', items: ['remove-all-from-list'] },
  ]);
  assert.equal(groups[1]?.items[0]?.label, 'Remove all from list');
});

test('listView uses remove filtered when filters narrow the view', () => {
  const groups = buildLeadsWorkbenchActionGroups({
    kind: 'listView',
    leadCount: 50,
    filteredCount: 12,
    hasActiveFilters: true,
    onAddAllToCampaign: noop,
    onRemoveAllFromList: noop,
    onRemoveFilteredFromList: noop,
  });
  assert.deepEqual(itemKeys(groups), [
    { id: 'campaigns', items: ['add-all-to-campaign'] },
    { id: 'lists', items: ['remove-filtered-from-list'] },
  ]);
  assert.equal(groups[1]?.items[0]?.label, 'Remove filtered (12)');
});

test('buildLeadsWorkbenchScopeLabel returns null for empty selection', () => {
  assert.equal(
    buildLeadsWorkbenchScopeLabel({
      kind: 'explorerSelection',
      selectedCount: 0,
      onCreateListFromSelection: noop,
      ...selectionHandlers,
    }),
    null,
  );
});

test('buildLeadsWorkbenchScopeLabel formats list filtered view', () => {
  assert.equal(
    buildLeadsWorkbenchScopeLabel({
      kind: 'listView',
      leadCount: 50,
      filteredCount: 12,
      hasActiveFilters: true,
      onAddAllToCampaign: noop,
      onRemoveAllFromList: noop,
    }),
    '12 of 50 leads in filtered view',
  );
});
