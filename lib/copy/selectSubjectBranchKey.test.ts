import assert from 'node:assert/strict';
import test from 'node:test';
import { processSpintax, buildSpintaxSeed } from '../email/processSpintax';
import { expandSubjectSpintax, selectSubjectBranchKey } from './expandSubjectSpintax';

test('selectSubjectBranchKey matches processSpintax for one group', () => {
  const subject = '{Quick question|A thought} for {{first_name}}';
  const seed = buildSpintaxSeed({
    campaignId: 'campaign-1',
    leadId: 'lead-1',
    variantId: 'variant-1',
  });
  const key = selectSubjectBranchKey(subject, seed);
  const expansion = expandSubjectSpintax(subject);
  const resolved = expansion.branches.find((branch) => branch.branchKey === key)?.resolvedSubject;
  assert.equal(processSpintax(subject, { seed, scope: 'subject' }), resolved);
  assert.ok(key === '0' || key === '1');
});

test('selectSubjectBranchKey matches processSpintax for two groups', () => {
  const subject = '{Hi|Hey} {{first_name}}, {ready to scale?|quick question}';
  const seed = buildSpintaxSeed({
    campaignId: 'campaign-1',
    leadId: 'lead-2',
    variantId: 'variant-1',
  });
  const key = selectSubjectBranchKey(subject, seed);
  assert.match(key, /^[01]-[01]$/);
  const expansion = expandSubjectSpintax(subject);
  const resolved = expansion.branches.find((branch) => branch.branchKey === key)?.resolvedSubject;
  assert.equal(processSpintax(subject, { seed, scope: 'subject' }), resolved);
});

test('selectSubjectBranchKey is empty when there is no spintax', () => {
  assert.equal(selectSubjectBranchKey('Quick question for {{first_name}}', 'seed'), '');
});

test('selectSubjectBranchKey ignores merge tags', () => {
  assert.equal(selectSubjectBranchKey('Hey {{first_name}}, any updates?', 'seed'), '');
});
