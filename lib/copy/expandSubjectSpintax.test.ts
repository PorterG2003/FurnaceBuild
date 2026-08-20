import assert from 'node:assert/strict';
import test from 'node:test';
import { expandSubjectSpintax } from './expandSubjectSpintax';

test('no spintax returns single branch with empty key', () => {
  const result = expandSubjectSpintax('Quick question for {{first_name}}');
  assert.equal(result.branches.length, 1);
  assert.equal(result.branches[0]!.branchKey, '');
  assert.equal(result.branches[0]!.resolvedSubject, 'Quick question for {{first_name}}');
  assert.equal(result.groups.length, 0);
});

test('single spintax group expands to branches', () => {
  const result = expandSubjectSpintax('{Quick question|A thought} for {{first_name}}');
  assert.equal(result.branches.length, 2);
  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0]!.optionCount, 2);
  assert.equal(result.groups[0]!.optionsRaw, 'Quick question|A thought');

  assert.equal(result.branches[0]!.branchKey, '0');
  assert.equal(result.branches[0]!.resolvedSubject, 'Quick question for {{first_name}}');
  assert.equal(result.branches[1]!.branchKey, '1');
  assert.equal(result.branches[1]!.resolvedSubject, 'A thought for {{first_name}}');
});

test('multiple spintax groups produce Cartesian product', () => {
  const result = expandSubjectSpintax('{Hi|Hey} {{first_name}}, {ready to scale?|quick question}');
  assert.equal(result.branches.length, 4);
  assert.equal(result.groups.length, 2);

  const keys = result.branches.map((b) => b.branchKey);
  assert.deepEqual(keys, ['0-0', '0-1', '1-0', '1-1']);

  assert.equal(
    result.branches[0]!.resolvedSubject,
    'Hi {{first_name}}, ready to scale?',
  );
  assert.equal(
    result.branches[3]!.resolvedSubject,
    'Hey {{first_name}}, quick question',
  );
});

test('Cartesian product exceeding 12 falls back to raw template', () => {
  const groups = Array.from({ length: 4 }, (_, i) => `{a${i}|b${i}|c${i}|d${i}}`);
  const subject = groups.join(' ');
  const result = expandSubjectSpintax(subject);
  assert.equal(result.branches.length, 1);
  assert.equal(result.branches[0]!.resolvedSubject, subject);
  assert.equal(result.groups.length, 0);
});

test('merge tags are not treated as spintax', () => {
  const result = expandSubjectSpintax('Hey {{first_name}}, any updates?');
  assert.equal(result.branches.length, 1);
  assert.equal(result.groups.length, 0);
});

test('three-branch single group', () => {
  const result = expandSubjectSpintax('{Scale|Grow|Expand} your team');
  assert.equal(result.branches.length, 3);
  assert.deepEqual(
    result.branches.map((b) => b.resolvedSubject),
    ['Scale your team', 'Grow your team', 'Expand your team'],
  );
});
