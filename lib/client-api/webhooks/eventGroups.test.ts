import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ALL_WEBHOOK_EVENT_TYPES,
  flattenWebhookEventGroups,
  mergeGroupSelectionWithStoredEvents,
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
