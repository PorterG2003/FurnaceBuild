import type { AccountLeadExplorerQuery } from '@/lib/supabase/services/leads/account-leads';
import type { SavedLeadListPeopleQuery } from '@/lib/supabase/services/leads/saved-lists';

export type BulkScopeKind = 'selection' | 'explorerView' | 'savedListAll' | 'savedListFiltered';

export type BulkScope =
  | {
      kind: 'selection';
      globalLeadIds: string[];
    }
  | {
      kind: 'explorerView';
      query: Omit<AccountLeadExplorerQuery, 'limit' | 'offset'>;
    }
  | {
      kind: 'savedListAll';
      listId: string;
    }
  | {
      kind: 'savedListFiltered';
      listId: string;
      query: Omit<SavedLeadListPeopleQuery, 'limit' | 'offset'>;
    };

export function isSelectionScope(scope: BulkScope): scope is Extract<BulkScope, { kind: 'selection' }> {
  return scope.kind === 'selection';
}

export function isExplorerViewScope(scope: BulkScope): scope is Extract<BulkScope, { kind: 'explorerView' }> {
  return scope.kind === 'explorerView';
}

export function isSavedListAllScope(scope: BulkScope): scope is Extract<BulkScope, { kind: 'savedListAll' }> {
  return scope.kind === 'savedListAll';
}

export function isSavedListFilteredScope(
  scope: BulkScope,
): scope is Extract<BulkScope, { kind: 'savedListFiltered' }> {
  return scope.kind === 'savedListFiltered';
}

export function bulkScopeFromListMembership(
  scope: 'selection' | 'explorerView' | 'listAll' | 'listFiltered',
  params: {
    globalLeadIds?: string[];
    explorerQuery?: Omit<AccountLeadExplorerQuery, 'limit' | 'offset'>;
    listId?: string | null;
    listPeopleQuery?: Omit<SavedLeadListPeopleQuery, 'limit' | 'offset'>;
  },
): BulkScope {
  switch (scope) {
    case 'explorerView':
      if (!params.explorerQuery) {
        throw new Error('Explorer query is required for explorer view scope.');
      }
      return { kind: 'explorerView', query: params.explorerQuery };
    case 'listAll':
      if (!params.listId) {
        throw new Error('List id is required for list-all scope.');
      }
      return { kind: 'savedListAll', listId: params.listId };
    case 'listFiltered':
      if (!params.listId || !params.listPeopleQuery) {
        throw new Error('List id and filters are required for filtered list scope.');
      }
      return {
        kind: 'savedListFiltered',
        listId: params.listId,
        query: params.listPeopleQuery,
      };
    default:
      return { kind: 'selection', globalLeadIds: params.globalLeadIds ?? [] };
  }
}

export function bulkScopeFromCampaignList(savedListId: string | null, globalLeadIds: string[]): BulkScope {
  if (savedListId) {
    return { kind: 'savedListAll', listId: savedListId };
  }
  return { kind: 'selection', globalLeadIds };
}
