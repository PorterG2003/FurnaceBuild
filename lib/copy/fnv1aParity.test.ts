import assert from 'node:assert/strict';
import test from 'node:test';
import { fnv1a32, selectSpintaxOptionIndex } from '../email/processSpintax';

test('fnv1a32 returns expected hash for empty string', () => {
  assert.equal(fnv1a32(''), 0x811c9dc5);
});

test('fnv1a32 returns expected hash for known inputs', () => {
  assert.equal(fnv1a32('a'), 0xe40c292c);
  assert.equal(fnv1a32('ab'), 0x4d2505ca);
  assert.equal(fnv1a32('abc'), 0x1a47e90b);
});

test('fnv1a32 spintax seed produces deterministic branch selection', () => {
  const seed = 'spintax:v1:campaign-1:lead-1:variant-1';
  const scope = 'subject';
  const path = '0';
  const optionsRaw = 'Quick question|A thought|Scale your team';
  const optionCount = 3;

  const NUL = '\x00';
  const key = seed + NUL + scope + NUL + path + NUL + optionsRaw;
  const hash = fnv1a32(key);
  const branchIndex = hash % optionCount;

  assert.ok(hash > 0);
  assert.ok(branchIndex >= 0 && branchIndex < optionCount);

  const branchViaHelper = selectSpintaxOptionIndex(optionCount, {
    seed,
    scope,
    path,
    optionsRaw,
  });
  assert.equal(branchIndex, branchViaHelper);
});

test('fnv1a32 seed string format matches SQL computation inputs', () => {
  const campaignId = '550e8400-e29b-41d4-a716-446655440000';
  const leadId = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
  const variantId = '6ba7b811-9dad-11d1-80b4-00c04fd430c8';
  const seed = `spintax:v1:${campaignId}:${leadId}:${variantId}`;

  const groupIndex = 0;
  const optionsRaw = 'Scale your team?|Quick compliance question';
  const optionCount = 2;

  const NUL = '\x00';
  const sqlEquivalentInput =
    seed + NUL + 'subject' + NUL + String(groupIndex) + NUL + optionsRaw;

  const hash = fnv1a32(sqlEquivalentInput);
  const branchIndex = hash % optionCount;

  assert.ok(typeof hash === 'number');
  assert.ok(branchIndex === 0 || branchIndex === 1);

  const hash2 = fnv1a32(sqlEquivalentInput);
  assert.equal(hash, hash2, 'same input produces same hash');
});

test('different leads get different branches for same content', () => {
  const campaignId = '550e8400-e29b-41d4-a716-446655440000';
  const variantId = '6ba7b811-9dad-11d1-80b4-00c04fd430c8';
  const optionsRaw = 'A|B';

  const branches = new Set<number>();
  for (let i = 0; i < 20; i++) {
    const leadId = `6ba7b8${i.toString(16).padStart(2, '0')}0-9dad-11d1-80b4-00c04fd430c8`;
    const seed = `spintax:v1:${campaignId}:${leadId}:${variantId}`;
    const NUL = '\x00';
    const key = seed + NUL + 'subject' + NUL + '0' + NUL + optionsRaw;
    branches.add(fnv1a32(key) % 2);
  }
  assert.equal(branches.size, 2, 'at least some leads get each branch');
});
