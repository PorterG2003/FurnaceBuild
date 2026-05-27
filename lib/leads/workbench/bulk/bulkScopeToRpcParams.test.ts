import test from 'node:test';
import assert from 'node:assert/strict';
import { listMembershipReviewRpcForScope } from './bulkScopeToRpcParams';
import type { BulkScope } from './bulkScope';

test('listMembershipReviewRpcForScope maps selection to ids review RPC', () => {
  const scope: BulkScope = { kind: 'selection', globalLeadIds: ['a', 'b'] };
  const mapped = listMembershipReviewRpcForScope(scope, 'add');
  assert.equal(mapped.rpc, 'saved_list_membership_review_summary');
  if (mapped.rpc === 'saved_list_membership_review_summary') {
    assert.deepEqual(mapped.params.p_global_lead_ids, ['a', 'b']);
    assert.equal(mapped.params.p_mode, 'add');
  }
});

test('listMembershipReviewRpcForScope maps explorer view to scoped review RPC', () => {
  const scope: BulkScope = {
    kind: 'explorerView',
    query: { searchQuery: '  acme  ', campaignIds: ['camp-1'] },
  };
  const mapped = listMembershipReviewRpcForScope(scope, 'remove');
  assert.equal(mapped.rpc, 'saved_list_membership_review_summary_for_explorer_view');
  if (mapped.rpc === 'saved_list_membership_review_summary_for_explorer_view') {
    assert.equal(mapped.params.p_search, 'acme');
    assert.deepEqual(mapped.params.p_campaign_ids, ['camp-1']);
    assert.equal(mapped.params.p_mode, 'remove');
  }
});

test('listMembershipReviewRpcForScope maps list-all to for_list review RPC', () => {
  const scope: BulkScope = { kind: 'savedListAll', listId: 'list-1' };
  const mapped = listMembershipReviewRpcForScope(scope, 'remove');
  assert.equal(mapped.rpc, 'saved_list_membership_review_summary_for_list');
});

test('listMembershipReviewRpcForScope maps filtered list to list view review RPC', () => {
  const scope: BulkScope = {
    kind: 'savedListFiltered',
    listId: 'list-1',
    query: { replyStatuses: ['no_reply'] },
  };
  const mapped = listMembershipReviewRpcForScope(scope, 'remove');
  assert.equal(mapped.rpc, 'saved_list_membership_review_summary_for_list_view');
  if (mapped.rpc === 'saved_list_membership_review_summary_for_list_view') {
    assert.deepEqual(mapped.params.p_reply_statuses, ['no_reply']);
  }
});
