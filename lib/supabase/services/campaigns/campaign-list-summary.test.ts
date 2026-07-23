import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCampaignsListSummaryRpcArgs,
  mapCampaignsListSummaryRpcRow,
} from './campaign-list-summary-rpc-map';

test('buildCampaignsListSummaryRpcArgs omits optional filters when opts absent', () => {
  assert.deepEqual(buildCampaignsListSummaryRpcArgs('account-1'), {
    p_account_id: 'account-1',
    p_search: null,
    p_statuses: null,
    p_tag_ids: null,
    p_limit: null,
    p_cursor_created_at: null,
    p_cursor_id: null,
  });
});

test('buildCampaignsListSummaryRpcArgs passes search statuses tags limit and cursor', () => {
  assert.deepEqual(
    buildCampaignsListSummaryRpcArgs('account-1', {
      search: '  Acme  ',
      statuses: ['running', 'paused'],
      tagIds: ['tag-1'],
      limit: 20,
      cursor: { createdAt: '2026-07-01T00:00:00.000Z', id: 'camp-9' },
    }),
    {
      p_account_id: 'account-1',
      p_search: 'Acme',
      p_statuses: ['running', 'paused'],
      p_tag_ids: ['tag-1'],
      p_limit: 20,
      p_cursor_created_at: '2026-07-01T00:00:00.000Z',
      p_cursor_id: 'camp-9',
    },
  );
});

test('buildCampaignsListSummaryRpcArgs treats empty arrays and blank search as null', () => {
  assert.deepEqual(
    buildCampaignsListSummaryRpcArgs('account-1', {
      search: '   ',
      statuses: [],
      tagIds: [],
      limit: null,
    }),
    {
      p_account_id: 'account-1',
      p_search: null,
      p_statuses: null,
      p_tag_ids: null,
      p_limit: null,
      p_cursor_created_at: null,
      p_cursor_id: null,
    },
  );
});

test('mapCampaignsListSummaryRpcRow maps snake_case and coerces null counts to zero', () => {
  const mapped = mapCampaignsListSummaryRpcRow({
    id: 'c1',
    name: 'Campaign',
    status: 'running',
    created_at: '2026-07-01T00:00:00.000Z',
    source: null,
    has_flow: true,
    sent_count: null as unknown as number,
    replied_count: 2,
    positive_reply_count: null as unknown as number,
    bounce_count: 1,
    enrollment_count: 10,
    terminal_enrollment_count: 3,
    contacted_enrollment_count: 4,
  });

  assert.deepEqual(mapped, {
    id: 'c1',
    name: 'Campaign',
    status: 'running',
    createdAt: '2026-07-01T00:00:00.000Z',
    source: null,
    hasFlow: true,
    sentCount: 0,
    repliedCount: 2,
    positiveReplyCount: 0,
    bounceCount: 1,
    enrollmentCount: 10,
    terminalEnrollmentCount: 3,
    contactedEnrollmentCount: 4,
  });
});
