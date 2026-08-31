import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CUSTOM_FIELDS_BYTE_BUDGET,
  WEBHOOK_BODY_TEXT_MAX_CHARS,
  buildCappedCustomFields,
  buildLeadWebhookIdentity,
  composeBounceReason,
  promoteLeadTitle,
  stringifyCustomFieldValue,
  truncateWebhookBodyText,
} from './leadWebhookIdentity.js';

const baseInput = {
  campaignId: 'campaign-1',
  campaignName: 'Wasatch corridor',
  leadId: 'lead-1',
  email: 'lead@example.com',
  mailboxId: 'mailbox-1',
  mailboxEmail: 'sender@example.com',
};

test('omits null, undefined, and whitespace-only contact fields', () => {
  const payload = buildLeadWebhookIdentity({
    ...baseInput,
    firstName: '  ',
    lastName: null,
    fullName: undefined,
    companyName: '\t',
    website: '',
  });

  assert.equal('first_name' in payload, false);
  assert.equal('last_name' in payload, false);
  assert.equal('full_name' in payload, false);
  assert.equal('company_name' in payload, false);
  assert.equal('website' in payload, false);
  assert.equal(JSON.stringify(payload).includes('""'), false);
});

test('null and empty custom_lead_data omit custom_fields entirely', () => {
  assert.equal('custom_fields' in buildLeadWebhookIdentity({ ...baseInput, customLeadData: null }), false);
  assert.equal('custom_fields' in buildLeadWebhookIdentity({ ...baseInput, customLeadData: {} }), false);
});

test('caps custom_fields at 8192 bytes and flags truncation', () => {
  const customLeadData: Record<string, string> = {};
  for (let i = 0; i < 200; i += 1) {
    customLeadData[`k${String(i).padStart(3, '0')}`] = 'x'.repeat(80);
  }

  const built = buildCappedCustomFields(customLeadData);
  assert.ok(built.custom_fields);
  assert.equal(built.custom_fields_truncated, true);
  assert.ok(Buffer.byteLength(JSON.stringify(built.custom_fields), 'utf8') <= CUSTOM_FIELDS_BYTE_BUDGET);
  assert.ok(Object.keys(built.custom_fields).length < 200);
});

test('custom_fields key order is deterministic', () => {
  const first = buildCappedCustomFields({ zeta: '1', alpha: '2', mu: '3' });
  const second = buildCappedCustomFields({ mu: '3', zeta: '1', alpha: '2' });
  assert.deepEqual(Object.keys(first.custom_fields ?? {}), ['alpha', 'mu', 'zeta']);
  assert.deepEqual(Object.keys(second.custom_fields ?? {}), ['alpha', 'mu', 'zeta']);
});

test('budget is counted in UTF-8 bytes, not characters', () => {
  const cjk = '測'.repeat(3000);
  assert.ok(cjk.length < CUSTOM_FIELDS_BYTE_BUDGET);
  assert.ok(Buffer.byteLength(cjk, 'utf8') > CUSTOM_FIELDS_BYTE_BUDGET);

  const built = buildCappedCustomFields({
    a: 'ok',
    wide: cjk,
  });
  assert.deepEqual(built.custom_fields, { a: 'ok' });
  assert.equal(built.custom_fields_truncated, true);
});

test('non-scalar custom values are JSON-stringified', () => {
  const built = buildCappedCustomFields({
    count: 4,
    flag: true,
    nested: { city: 'Ogden' },
    tags: ['a', 'b'],
  });
  assert.equal(built.custom_fields?.count, '4');
  assert.equal(built.custom_fields?.flag, 'true');
  assert.equal(built.custom_fields?.nested, '{"city":"Ogden"}');
  assert.equal(built.custom_fields?.tags, '["a","b"]');
});

test('reserved custom keys stay nested and do not overwrite identity fields', () => {
  const payload = buildLeadWebhookIdentity({
    ...baseInput,
    customLeadData: {
      email: 'other@example.com',
      campaign_name: 'Spoofed',
      title: 'VP Sales',
    },
  });

  assert.equal(payload.email, 'lead@example.com');
  assert.equal(payload.campaign_name, 'Wasatch corridor');
  assert.equal(payload.custom_fields?.email, 'other@example.com');
  assert.equal(payload.custom_fields?.campaign_name, 'Spoofed');
  assert.equal(payload.title, 'VP Sales');
});

test('title promotion prefers title over job_title, case-insensitive', () => {
  assert.equal(promoteLeadTitle({ Title: 'Director' }), 'Director');
  assert.equal(promoteLeadTitle({ job_title: 'Analyst' }), 'Analyst');
  assert.equal(promoteLeadTitle({ title: 'VP', job_title: 'Analyst' }), 'VP');
  assert.equal(promoteLeadTitle({ title: '  ', job_title: 'Analyst' }), 'Analyst');
  assert.equal(promoteLeadTitle({ title: '', job_title: '' }), undefined);
  assert.equal(promoteLeadTitle({ region: 'west' }), undefined);
});

test('stringifyCustomFieldValue drops empty strings', () => {
  assert.equal(stringifyCustomFieldValue('  '), undefined);
  assert.equal(stringifyCustomFieldValue(null), undefined);
});

test('truncateWebhookBodyText cuts at the 16k boundary', () => {
  const exact = 'a'.repeat(WEBHOOK_BODY_TEXT_MAX_CHARS);
  const over = `${exact}zzzz`;
  assert.equal(truncateWebhookBodyText(exact), exact);
  assert.equal(truncateWebhookBodyText(over), exact);
});

test('composeBounceReason joins severity and SMTP code', () => {
  assert.equal(composeBounceReason('hard', '550'), 'hard 550');
  assert.equal(composeBounceReason('soft', '  '), 'soft');
  assert.equal(composeBounceReason('hard', null), 'hard');
});
