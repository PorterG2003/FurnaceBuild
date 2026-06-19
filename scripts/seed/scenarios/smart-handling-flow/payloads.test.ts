import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildSeedAiMetadata,
  buildSeedInterestedMetadata,
  buildSeedNeutralMetadata,
  buildSeedNotInterestedMetadata,
  buildSeedOooDatedMetadata,
  buildSeedOooNoDateMetadata,
  buildSeedWrongContactMetadata,
} from './payloads';

test('buildSeedInterestedMetadata exposes reply and classify alternatives', () => {
  const metadata = buildSeedInterestedMetadata();
  assert.equal(metadata.mode, 'manual');
  assert.equal(metadata.primary?.action, 'mark_interested_reply');
  assert.deepEqual(
    metadata.alternatives?.map((option) => option.action),
    ['mark_interested', 'reply_only'],
  );
});

test('buildSeedNeutralMetadata exposes interested reply and not interested alternatives', () => {
  const metadata = buildSeedNeutralMetadata();
  assert.equal(metadata.primary?.action, 'mark_neutral');
  assert.deepEqual(metadata.alternatives?.map((option) => option.action), [
    'mark_interested_reply',
    'mark_not_interested',
  ]);
});

test('buildSeedNotInterestedMetadata uses block primary when reply requests removal', () => {
  const metadata = buildSeedNotInterestedMetadata({
    bodyText: 'Please remove me from your list.',
  });
  assert.equal(metadata.primary?.action, 'mark_not_interested_block');
  assert.deepEqual(metadata.alternatives?.map((option) => option.action), ['mark_not_interested']);
});

test('buildSeedNotInterestedMetadata uses soft primary without opt-out language', () => {
  const metadata = buildSeedNotInterestedMetadata({
    bodyText: 'Not interested right now, thanks.',
  });
  assert.equal(metadata.primary?.action, 'mark_not_interested');
  assert.deepEqual(metadata.alternatives?.map((option) => option.action), ['mark_not_interested_block']);
});

test('buildSeedOooDatedMetadata carries the supplied return date', () => {
  const metadata = buildSeedOooDatedMetadata('2026-07-01');
  assert.equal(metadata.return_date, '2026-07-01');
  assert.equal(metadata.primary?.action, 'mark_ooo_dated');
  assert.deepEqual(metadata.alternatives?.map((option) => option.action), [
    'mark_ooo_instant',
    'mark_ooo_custom',
  ]);
});

test('buildSeedOooNoDateMetadata uses the month resume default', () => {
  const metadata = buildSeedOooNoDateMetadata();
  assert.equal(metadata.primary?.action, 'mark_ooo_month');
  assert.deepEqual(metadata.alternatives?.map((option) => option.action), [
    'mark_ooo_instant',
    'mark_ooo_custom',
  ]);
});

test('buildSeedWrongContactMetadata marks header mismatch and suggested referral', () => {
  const metadata = buildSeedWrongContactMetadata('alt@example.com');
  assert.equal(metadata.primary?.action, 'replace_lead');
  assert.equal(metadata.header_mismatch, true);
  assert.equal(metadata.suggested_referral?.email, 'alt@example.com');
});

test('buildSeedAiMetadata creates an info-only AI payload', () => {
  const metadata = buildSeedAiMetadata('Interested');
  assert.equal(metadata.mode, 'ai');
  assert.equal(metadata.category, 'Interested');
  assert.equal(metadata.primary, null);
});
