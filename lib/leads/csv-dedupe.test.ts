import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createEmptyCsvFieldMappings,
  dedupeWithinFile,
  extractUniqueEmailsFromRows,
  filterBlockedEmails,
  filterExistingCampaignEmails,
  mapCsvRowToLeadPayload,
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
