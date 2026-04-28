import test from 'node:test';
import assert from 'node:assert/strict';
import {
  collectAllFluxCopyFieldBudgetsForInvariant,
  formatFluxCopyBudgetsForPrompt,
  getFluxCopyBudgetViolations,
  getTierForPreset,
} from './fluxCopyBudgets.js';
import type { PageConfig } from './types.js';

test('getTierForPreset: minimal and outlined are tight', () => {
  assert.equal(getTierForPreset('minimal'), 'tight');
  assert.equal(getTierForPreset('outlined'), 'tight');
});

test('getTierForPreset: classic elevated soft are standard', () => {
  assert.equal(getTierForPreset('classic'), 'standard');
  assert.equal(getTierForPreset('elevated'), 'standard');
  assert.equal(getTierForPreset('soft'), 'standard');
});

test('getTierForPreset: undefined uses default classic → standard', () => {
  assert.equal(getTierForPreset(undefined), 'standard');
});

test('every field budget has hardMaxChars greater than targetChars', () => {
  for (const r of collectAllFluxCopyFieldBudgetsForInvariant()) {
    assert.ok(
      r.hardMaxChars > r.targetChars,
      `${r.label}: hard ${r.hardMaxChars} must exceed target ${r.targetChars}`,
    );
  }
});

test('getFluxCopyBudgetViolations: empty for short hero', () => {
  const merged: PageConfig = {
    theme: {
      primaryColor: '#111',
      accentColor: '#222',
      backgroundColor: '#eee',
      textColor: '#000',
      fontFamily: 'Inter',
      blockStylePreset: 'classic',
    },
    prospectName: 'A',
    companyName: 'B',
    blocks: [
      {
        id: 'h1',
        type: 'hero',
        order: 0,
        props: {
          headline: 'Short',
          subheadline: 'Also short',
          ctaText: 'Go',
          ctaUrl: 'https://example.com',
        },
      },
    ],
  };
  assert.deepEqual(getFluxCopyBudgetViolations(merged), []);
});

test('getFluxCopyBudgetViolations: hero headline over hard fails with target and tier', () => {
  const longHeadline = 'x'.repeat(89);
  const merged: PageConfig = {
    theme: {
      primaryColor: '#111',
      accentColor: '#222',
      backgroundColor: '#eee',
      textColor: '#000',
      fontFamily: 'Inter',
      blockStylePreset: 'classic',
    },
    prospectName: 'A',
    companyName: 'B',
    blocks: [
      {
        id: 'h1',
        type: 'hero',
        order: 0,
        props: {
          headline: longHeadline,
          subheadline: 'Sub',
          ctaText: 'Go',
          ctaUrl: 'https://example.com',
        },
      },
    ],
  };
  const v = getFluxCopyBudgetViolations(merged);
  assert.equal(v.length, 1);
  assert.match(v[0]!, /props\.headline length 89 exceeds hard max 88/);
  assert.match(v[0]!, /target 56/);
  assert.match(v[0]!, /tier standard/);
});

test('getFluxCopyBudgetViolations: headline length in (target, hard] passes', () => {
  const merged: PageConfig = {
    theme: {
      primaryColor: '#111',
      accentColor: '#222',
      backgroundColor: '#eee',
      textColor: '#000',
      fontFamily: 'Inter',
      blockStylePreset: 'classic',
    },
    prospectName: 'A',
    companyName: 'B',
    blocks: [
      {
        id: 'h1',
        type: 'hero',
        order: 0,
        props: {
          headline: 'x'.repeat(72),
          subheadline: 'Sub',
          ctaText: 'Go',
          ctaUrl: 'https://example.com',
        },
      },
    ],
  };
  assert.deepEqual(getFluxCopyBudgetViolations(merged), []);
});

test('formatFluxCopyBudgetsForPrompt includes preset map and fixed instruction lines', () => {
  const s = formatFluxCopyBudgetsForPrompt();
  assert.match(s, /minimal or outlined/);
  assert.match(s, /classic, elevated, or soft/);
  assert.match(s, /Prefer staying at or below Target/);
  assert.match(s, /If any string exceeds Hard max/);
  assert.match(s, /Use the table row for the tier that matches theme\.blockStylePreset/);
});
