import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ALL_WEBHOOK_EVENT_TYPES,
  expandWebhookSelectionForDisplay,
  flattenWebhookEventGroups,
  formatWebhookEventsSummary,
  groupSelectionState,
  mergeGroupSelectionWithStoredEvents,
  normalizeWebhookSelectionForStorage,
  toggleGroupEvents,
  webhookGroupIdsFromStoredEvents,
  WEBHOOK_EVENT_GROUPS,
} from './eventGroups.js';

test('WEBHOOK_EVENT_GROUPS cover all allowed webhook events exactly once', () => {
  const grouped = WEBHOOK_EVENT_GROUPS.flatMap((group) => group.events);
  assert.deepEqual([...grouped].sort(), [...ALL_WEBHOOK_EVENT_TYPES].sort());
});

test('flattenWebhookEventGroups expands selected groups', () => {
  const events = flattenWebhookEventGroups(['lead_added_updated', 'lead_removed']);
  assert.ok(events.includes('lead.created'));
  assert.ok(events.includes('lead.bulk_import.completed'));
  assert.ok(events.includes('lead.deleted'));
  assert.ok(events.includes('lead.removed_from_campaign.completed'));
  assert.equal(events.includes('email.sent'), false);
});

test('webhookGroupIdsFromStoredEvents returns fully selected groups only', () => {
  const groupIds = webhookGroupIdsFromStoredEvents([
    'lead.created',
    'lead.updated',
    'lead.bulk_import.completed',
    'lead.added_to_campaign.completed',
  ]);
  assert.deepEqual(groupIds, ['lead_added_updated']);
});

test('mergeGroupSelectionWithStoredEvents keeps legacy stored events', () => {
  const merged = mergeGroupSelectionWithStoredEvents(['email_activity'], ['lead.created']);
  assert.ok(merged.includes('email.sent'));
  assert.ok(merged.includes('lead.created'));
});

test('expandWebhookSelectionForDisplay keeps empty storage as none selected', () => {
  assert.deepEqual(expandWebhookSelectionForDisplay([]), []);
});

test('normalizeWebhookSelectionForStorage keeps full selection explicit', () => {
  assert.deepEqual(normalizeWebhookSelectionForStorage(ALL_WEBHOOK_EVENT_TYPES), [
    ...ALL_WEBHOOK_EVENT_TYPES,
  ].sort());
});

test('normalizeWebhookSelectionForStorage keeps partial selections sorted', () => {
  assert.deepEqual(normalizeWebhookSelectionForStorage(['reply.categorized', 'email.sent']), [
    'email.sent',
    'reply.categorized',
  ]);
});

test('groupSelectionState reflects partial group picks', () => {
  const group = WEBHOOK_EVENT_GROUPS.find((entry) => entry.id === 'email_activity');
  assert.ok(group);
  const selected = new Set(['email.sent', 'reply.categorized'] as const);
  assert.equal(groupSelectionState(group!, selected), 'some');
});

test('toggleGroupEvents selects and clears group members', () => {
  const selected = toggleGroupEvents('email_activity', ['lead.created'], true);
  assert.ok(selected.includes('email.sent'));
  assert.ok(selected.includes('reply.categorized'));
  assert.ok(selected.includes('lead.created'));

  const cleared = toggleGroupEvents('email_activity', selected, false);
  assert.equal(cleared.includes('email.sent'), false);
  assert.equal(cleared.includes('reply.categorized'), false);
  assert.ok(cleared.includes('lead.created'));
});

test('formatWebhookEventsSummary shows none when storage is empty', () => {
  assert.deepEqual(formatWebhookEventsSummary([]), { kind: 'none' });
});

test('formatWebhookEventsSummary shows partial group counts', () => {
  const summary = formatWebhookEventsSummary(['email.sent', 'reply.categorized']);
  assert.equal(summary.kind, 'groups');
  if (summary.kind === 'groups') {
    assert.ok(summary.labels.some((label) => label.includes('Email activity (2/5)')));
  }
});
