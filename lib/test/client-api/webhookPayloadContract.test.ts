import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { DEFAULT_ALLOWED_WEBHOOK_EVENTS } from '../../webhooks/webhookEvents.js';
import { LEAD_ACTIVITY_WEBHOOK_EVENTS } from '../../webhooks/leadWebhookIdentity.js';
import { WEBHOOK_EVENT_DESCRIPTIONS } from '../../client-api/openapi/webhooks.js';
import {
  WEBHOOK_EVENT_GROUPS,
  WEBHOOK_EVENT_LABELS,
} from '../../client-api/webhooks/eventGroups.js';
import {
  WEBHOOK_DOC_SAMPLE_CONTEXT,
  buildWebhookTestPayload,
} from '../../client-api/webhooks/webhookTestSamples.js';

const IDENTITY_KEYS = [
  'campaign_id',
  'campaign_name',
  'lead_id',
  'email',
  'mailbox_id',
  'mailbox_email',
  'first_name',
  'last_name',
  'company_name',
] as const;

const snapshotPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'webhook-payload-samples.snapshot.json',
);

function collectEmptyStrings(value: unknown, trail: string, found: string[]): void {
  if (value === '') {
    found.push(trail || '(root)');
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectEmptyStrings(entry, `${trail}[${index}]`, found));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      collectEmptyStrings(nested, trail ? `${trail}.${key}` : key, found);
    }
  }
}

test('every allowed webhook event has a label, group, sample, and docs description', () => {
  const grouped = new Set(WEBHOOK_EVENT_GROUPS.flatMap((group) => group.events));
  for (const event of DEFAULT_ALLOWED_WEBHOOK_EVENTS) {
    assert.ok(WEBHOOK_EVENT_LABELS[event], `missing label for ${event}`);
    assert.ok(grouped.has(event), `missing group for ${event}`);
    assert.ok(WEBHOOK_EVENT_DESCRIPTIONS[event], `missing docs description for ${event}`);
    const sample = buildWebhookTestPayload(event, WEBHOOK_DOC_SAMPLE_CONTEXT, {
      includeTestFlag: false,
    });
    assert.equal(typeof sample, 'object');
  }
});

test('blocklist samples always include value and type', () => {
  for (const event of ['blocklist.entry_added', 'blocklist.entry_removed'] as const) {
    const sample = buildWebhookTestPayload(event, WEBHOOK_DOC_SAMPLE_CONTEXT, {
      includeTestFlag: false,
    });
    assert.equal(sample.value, 'lead@example.com');
    assert.equal(sample.type, 'email');
    assert.equal(sample.email, 'lead@example.com');
  }
});

test('lead-activity samples include the shared identity block', () => {
  for (const event of LEAD_ACTIVITY_WEBHOOK_EVENTS) {
    const sample = buildWebhookTestPayload(event, WEBHOOK_DOC_SAMPLE_CONTEXT, {
      includeTestFlag: false,
    });
    for (const key of IDENTITY_KEYS) {
      assert.ok(key in sample, `${event} sample missing ${key}`);
      assert.notEqual(sample[key], '');
    }
  }
});

test('sample payloads never include empty-string leaves', () => {
  for (const event of DEFAULT_ALLOWED_WEBHOOK_EVENTS) {
    const sample = buildWebhookTestPayload(event, WEBHOOK_DOC_SAMPLE_CONTEXT, {
      includeTestFlag: false,
    });
    const empty: string[] = [];
    collectEmptyStrings(sample, '', empty);
    assert.deepEqual(empty, [], `${event} has empty strings: ${empty.join(', ')}`);
  }
});

test('sample payload snapshot stays stable', () => {
  const current: Record<string, Record<string, unknown>> = {};
  for (const event of DEFAULT_ALLOWED_WEBHOOK_EVENTS) {
    current[event] = buildWebhookTestPayload(event, WEBHOOK_DOC_SAMPLE_CONTEXT, {
      includeTestFlag: false,
    });
  }
  const expected = JSON.parse(fs.readFileSync(snapshotPath, 'utf8')) as Record<string, unknown>;
  assert.deepEqual(current, expected);
});
