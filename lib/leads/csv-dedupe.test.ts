import test from 'node:test';
import assert from 'node:assert/strict';
import {
  autoMapExistingCustomKeys,
  createEmptyCsvFieldMappings,
  dedupeWithinFile,
  extractUniqueEmailsFromRows,
  filterBlockedEmails,
  filterExistingCampaignEmails,
  isValidCustomFieldKey,
  mapCsvRowToLeadPayload,
  normalizeCustomFieldKey,
  runCsvDedupePipeline,
} from './csv-dedupe';
import type { BlockListEntry } from '@/lib/supabase/types';

const blockEntry = (value: string, type: 'email' | 'domain'): BlockListEntry => ({
  id: `block-${value}`,
  account_id: 'acct-1',
  value,
  type,
  reason: 'manual',
  created_at: new Date().toISOString(),
});

test('dedupeWithinFile keeps first occurrence by email', () => {
  const rows = [
    { email: 'a@test.com', name: 'First' },
    { email: 'b@test.com', name: 'B' },
    { email: 'a@test.com', name: 'Second' },
  ];
  const { kept, removed } = dedupeWithinFile(rows, 'email');
  assert.equal(kept.length, 2);
  assert.equal(kept[0]?.name, 'First');
  assert.equal(removed, 1);
});

test('dedupeWithinFile is case-insensitive', () => {
  const rows = [
    { email: 'A@B.com', name: 'First' },
    { email: 'a@b.com', name: 'Second' },
  ];
  const { kept, removed } = dedupeWithinFile(rows, 'email');
  assert.equal(kept.length, 1);
  assert.equal(kept[0]?.name, 'First');
  assert.equal(removed, 1);
});

test('dedupeWithinFile handles missing email column gracefully', () => {
  const rows = [{ email: 'a@test.com' }, { email: 'a@test.com' }];
  const { kept, removed } = dedupeWithinFile(rows, undefined);
  assert.equal(kept.length, 2);
  assert.equal(removed, 0);
});

test('filterBlockedEmails removes exact email matches', () => {
  const rows = [{ email: 'blocked@test.com' }, { email: 'ok@test.com' }];
  const { kept, removed } = filterBlockedEmails(rows, 'email', [
    blockEntry('blocked@test.com', 'email'),
  ]);
  assert.equal(kept.length, 1);
  assert.equal(kept[0]?.email, 'ok@test.com');
  assert.equal(removed, 1);
});

test('filterBlockedEmails removes domain matches', () => {
  const rows = [{ email: 'one@blocked.com' }, { email: 'two@safe.com' }];
  const { kept, removed } = filterBlockedEmails(rows, 'email', [blockEntry('blocked.com', 'domain')]);
  assert.equal(kept.length, 1);
  assert.equal(kept[0]?.email, 'two@safe.com');
  assert.equal(removed, 1);
});

test('filterBlockedEmails returns empty blocked set when no entries', () => {
  const rows = [{ email: 'a@test.com' }];
  const { kept, removed } = filterBlockedEmails(rows, 'email', []);
  assert.equal(kept.length, 1);
  assert.equal(removed, 0);
});

test('filterExistingCampaignEmails removes known emails', () => {
  const rows = [{ email: 'exists@test.com' }, { email: 'new@test.com' }];
  const existing = new Set(['exists@test.com']);
  const { kept, removed } = filterExistingCampaignEmails(rows, 'email', existing);
  assert.equal(kept.length, 1);
  assert.equal(kept[0]?.email, 'new@test.com');
  assert.equal(removed, 1);
});

test('filterExistingCampaignEmails is case-insensitive', () => {
  const rows = [{ email: 'Exists@TEST.com' }];
  const existing = new Set(['exists@test.com']);
  const { kept, removed } = filterExistingCampaignEmails(rows, 'email', existing);
  assert.equal(kept.length, 0);
  assert.equal(removed, 1);
});

test('mapCsvRowToLeadPayload correctly maps all standard fields', () => {
  const mappings = {
    ...createEmptyCsvFieldMappings(),
    email: 'Email',
    first_name: 'First',
    last_name: 'Last',
    company_name: 'Company',
    website: 'Site',
    linkedin_url: 'LI',
    company_linkedin_url: 'CLI',
  };
  const payload = mapCsvRowToLeadPayload(
    {
      Email: 'person@test.com',
      First: 'Pat',
      Last: 'Lee',
      Company: 'Acme',
      Site: 'https://acme.test',
      LI: 'https://linkedin.com/in/pat',
      CLI: 'https://linkedin.com/company/acme',
    },
    mappings,
    ['Custom'],
  );
  assert.ok(payload);
  assert.equal(payload.email, 'person@test.com');
  assert.equal(payload.first_name, 'Pat');
  assert.equal(payload.last_name, 'Lee');
  assert.equal(payload.name, 'Pat Lee');
  assert.equal(payload.company_name, 'Acme');
  assert.equal(payload.website, 'https://acme.test');
  assert.equal(payload.linkedin_url, 'https://linkedin.com/in/pat');
  assert.equal(payload.company_linkedin_url, 'https://linkedin.com/company/acme');
});

test('mapCsvRowToLeadPayload skips rows with no primary data', () => {
  const mappings = createEmptyCsvFieldMappings();
  const payload = mapCsvRowToLeadPayload({ Notes: 'only custom' }, mappings, []);
  assert.equal(payload, null);
});

test('normalizeCustomFieldKey trims surrounding whitespace but preserves the inner key', () => {
  assert.equal(normalizeCustomFieldKey(' Title '), 'Title');
  assert.equal(normalizeCustomFieldKey('Title'), 'Title');
  assert.equal(normalizeCustomFieldKey('# Employees'), '# Employees');
  assert.equal(normalizeCustomFieldKey('  Years Until 2026  '), 'Years Until 2026');
});

test('isValidCustomFieldKey rejects blanks and template-breaking characters', () => {
  assert.equal(isValidCustomFieldKey(''), false);
  assert.equal(isValidCustomFieldKey('   '), false);
  assert.equal(isValidCustomFieldKey('a{b'), false);
  assert.equal(isValidCustomFieldKey('a}b'), false);
  assert.equal(isValidCustomFieldKey('{{custom.x}}'), false);
  assert.equal(isValidCustomFieldKey('# Employees'), true);
  assert.equal(isValidCustomFieldKey('Years Until 2026'), true);
});

test('mapCsvRowToLeadPayload writes existing custom keys under the normalized key name', () => {
  const mappings = { ...createEmptyCsvFieldMappings(), email: 'Email' };
  const payload = mapCsvRowToLeadPayload(
    { Email: 'person@test.com', IndustryColumn: 'SaaS' },
    mappings,
    [],
    { Industry: 'IndustryColumn' },
  );
  assert.ok(payload);
  assert.deepEqual(payload.custom_lead_data, { Industry: 'SaaS' });
});

test('mapCsvRowToLeadPayload trims a new custom column so it matches the DB-required key', () => {
  const mappings = { ...createEmptyCsvFieldMappings(), email: 'Email' };
  const payload = mapCsvRowToLeadPayload(
    { Email: 'person@test.com', ' Title ': 'CEO' },
    mappings,
    [' Title '],
  );
  assert.ok(payload);
  assert.deepEqual(payload.custom_lead_data, { Title: 'CEO' });
});

test('mapCsvRowToLeadPayload omits blank/unmapped existing custom keys', () => {
  const mappings = { ...createEmptyCsvFieldMappings(), email: 'Email' };
  const payload = mapCsvRowToLeadPayload(
    { Email: 'person@test.com', IndustryColumn: '' },
    mappings,
    [],
    { Industry: 'IndustryColumn', Title: '' },
  );
  assert.ok(payload);
  assert.equal(payload.custom_lead_data, undefined);
});

test('mapCsvRowToLeadPayload collision: existing-key mapping wins over a colliding new column', () => {
  const mappings = { ...createEmptyCsvFieldMappings(), email: 'Email' };
  const payload = mapCsvRowToLeadPayload(
    { Email: 'person@test.com', Industry: 'FromExistingMap', 'Industry ': 'FromNewColumn' },
    mappings,
    ['Industry '],
    { Industry: 'Industry' },
  );
  assert.ok(payload);
  // The new column "Industry " normalizes to "Industry" which the existing-key
  // mapping already owns, so it must not overwrite or duplicate.
  assert.deepEqual(payload.custom_lead_data, { Industry: 'FromExistingMap' });
});

test('autoMapExistingCustomKeys prefers exact header match then normalized fallback', () => {
  const headers = ['Email', 'Industry', 'job title'];
  const normalizedHeaders = headers.map((header) => header.trim().toLowerCase());
  const result = autoMapExistingCustomKeys(headers, normalizedHeaders, ['Industry', 'Job Title', 'Region']);
  assert.equal(result.Industry, 'Industry');
  assert.equal(result['Job Title'], 'job title');
  assert.equal(result.Region, undefined);
});

test('autoMapExistingCustomKeys does not reuse a column for two keys', () => {
  const headers = ['industry'];
  const normalizedHeaders = ['industry'];
  const result = autoMapExistingCustomKeys(headers, normalizedHeaders, ['Industry', 'industry']);
  const usedColumns = Object.values(result);
  assert.equal(new Set(usedColumns).size, usedColumns.length);
});

test('runCsvDedupePipeline aggregates stats correctly', () => {
  const rows = [
    { email: 'dup@test.com' },
    { email: 'dup@test.com' },
    { email: 'exists@test.com' },
    { email: 'blocked@test.com' },
    { email: 'fresh@test.com' },
  ];
  const result = runCsvDedupePipeline(rows, {
    dedupeWithinFile: true,
    filterInCampaigns: true,
    filterBlockList: true,
    emailColumn: 'email',
    matchingCampaignEmails: new Set(['exists@test.com']),
    blockListEntries: [blockEntry('blocked@test.com', 'email')],
  });
  assert.equal(result.stats.totalInput, 5);
  assert.equal(result.stats.removedWithinFile, 1);
  assert.equal(result.stats.removedInCampaigns, 1);
  assert.equal(result.stats.removedBlocked, 1);
  assert.equal(result.stats.kept, 2);
  assert.deepEqual(extractUniqueEmailsFromRows(result.kept, 'email').sort(), [
    'dup@test.com',
    'fresh@test.com',
  ]);
});

test('mapCsvRowToLeadPayload maps tags and verification columns', () => {
  const mappings = {
    ...createEmptyCsvFieldMappings(),
    email: 'Email',
    tags: 'Tags',
    verification_status: 'MV',
    verification_provider: 'Verifier',
    is_role: 'Role',
  };
  const payload = mapCsvRowToLeadPayload(
    {
      Email: 'person@test.com',
      Tags: 'Hunter.io, ICP Fit',
      MV: 'ok',
      Verifier: 'millionverifier',
      Role: 'yes',
    },
    mappings,
    [],
  );
  assert.ok(payload);
  assert.deepEqual(payload.tags, ['Hunter.io', 'ICP Fit']);
  assert.deepEqual(payload.email_verification, {
    status: 'ok',
    provider: 'millionverifier',
    is_role: true,
  });
});
