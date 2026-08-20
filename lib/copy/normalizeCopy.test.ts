import assert from 'node:assert/strict';
import test from 'node:test';
import {
  copyPieceFingerprint,
  isVerbatimCopySpan,
  normalizeCopyForFingerprint,
  normalizeCopyWhitespace,
  renderCopyDisplayText,
} from './normalizeCopy';

test('normalizeCopyWhitespace preserves template syntax while collapsing whitespace', () => {
  assert.equal(
    normalizeCopyWhitespace('  {Hi|Hey}  \n {{first_name}},\t welcome '),
    '{Hi|Hey} {{first_name}}, welcome',
  );
});

test('fingerprint normalization placeholders merge fields but preserves spintax', async () => {
  assert.equal(
    normalizeCopyForFingerprint('{Hi|Hey} {{first_name}}'),
    '{Hi|Hey} {{merge}}',
  );
  assert.equal(
    await copyPieceFingerprint('Hello {{first_name}}'),
    await copyPieceFingerprint('Hello   {{custom.contact_name}}'),
  );
  assert.notEqual(
    await copyPieceFingerprint('{Hello|Hi} {{first_name}}'),
    await copyPieceFingerprint('Hello {{first_name}}'),
  );
});

test('renderCopyDisplayText chooses first spin, strips merge tags, and salvages malformed syntax', () => {
  assert.equal(
    renderCopyDisplayText('{Hi {{first_name}}|Hello {{first_name}}}, want the audit?'),
    'Hi, want the audit?',
  );
  assert.equal(renderCopyDisplayText('{Web traffic|Web visits'), 'Web traffic');
});

test('isVerbatimCopySpan tolerates formatting whitespace but rejects paraphrases', () => {
  const source = 'We helped Acme grow 42%.\n\nWant the playbook?';
  assert.equal(isVerbatimCopySpan('We helped Acme grow 42%.', source), true);
  assert.equal(isVerbatimCopySpan('Want   the playbook?', source), true);
  assert.equal(isVerbatimCopySpan('Acme nearly doubled growth.', source), false);
});
