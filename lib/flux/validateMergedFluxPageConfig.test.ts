import test from 'node:test';
import assert from 'node:assert/strict';
import type { PageConfig } from './types.js';
import {
  getMergedFluxPageConfigSemanticIssues,
  formatMergedFluxSemanticIssuesForRepair,
} from './validateMergedFluxPageConfig.js';

const theme = {
  primaryColor: '#111111',
  accentColor: '#222222',
  backgroundColor: '#eeeeee',
  textColor: '#000000',
  fontFamily: 'Inter',
} as const;

function page(blocks: PageConfig['blocks']): PageConfig {
  return {
    theme,
    prospectName: 'Pat',
    companyName: 'Co',
    blocks,
  };
}

test('valid hero-only merged config passes with empty content_assets', () => {
  const merged = page([
    {
      id: 'h1',
      type: 'hero',
      order: 0,
      props: {
        headline: 'Hello',
        subheadline: 'There',
        ctaText: 'Go',
        ctaUrl: 'https://example.com',
      },
    },
  ]);
  const issues = getMergedFluxPageConfigSemanticIssues(merged, []);
  assert.deepEqual(issues, []);
});

test('empty hero headline fails', () => {
  const merged = page([
    {
      id: 'h1',
      type: 'hero',
      order: 0,
      props: {
        headline: '   ',
        subheadline: 'There',
        ctaText: 'Go',
        ctaUrl: 'https://example.com',
      },
    },
  ]);
  const issues = getMergedFluxPageConfigSemanticIssues(merged, []);
  assert.equal(issues.length, 1);
  assert.match(issues[0]!, /headline is empty/);
});

test('wrong case_study assetId when assets present fails', () => {
  const merged = page([
    {
      id: 'cs',
      type: 'case_study',
      order: 0,
      props: { assetId: 'wrong-id' },
    },
  ]);
  const assets = [{ id: 'real-1', type: 'case_study', title: 'T', body: 'B' }];
  const issues = getMergedFluxPageConfigSemanticIssues(merged, assets);
  assert.equal(issues.length, 1);
  assert.match(issues[0]!, /not a valid case_study/);
});

test('zero case_study assets and empty assetId passes', () => {
  const merged = page([
    {
      id: 'cs',
      type: 'case_study',
      order: 0,
      props: { assetId: '' },
    },
  ]);
  const issues = getMergedFluxPageConfigSemanticIssues(merged, []);
  assert.deepEqual(issues, []);
});

test('zero case_study assets and whitespace-only assetId passes', () => {
  const merged = page([
    {
      id: 'cs',
      type: 'case_study',
      order: 0,
      props: { assetId: '  \t  ' },
    },
  ]);
  const issues = getMergedFluxPageConfigSemanticIssues(merged, []);
  assert.deepEqual(issues, []);
});

test('zero case_study assets and non-empty bogus assetId fails', () => {
  const merged = page([
    {
      id: 'cs',
      type: 'case_study',
      order: 0,
      props: { assetId: 'made-up' },
    },
  ]);
  const issues = getMergedFluxPageConfigSemanticIssues(merged, []);
  assert.equal(issues.length, 1);
  assert.match(issues[0]!, /set assetId to ""|empty block/i);
});

test('case_study pool exists but empty assetId fails', () => {
  const merged = page([
    {
      id: 'cs',
      type: 'case_study',
      order: 0,
      props: { assetId: '' },
    },
  ]);
  const assets = [{ id: 'real-1', type: 'case_study', title: 'T', body: 'B' }];
  const issues = getMergedFluxPageConfigSemanticIssues(merged, assets);
  assert.equal(issues.length, 1);
  assert.match(issues[0]!, /assetId is empty but content_assets includes case_study/);
});

test('testimonial valid id passes', () => {
  const merged = page([
    {
      id: 't1',
      type: 'testimonial',
      order: 0,
      props: { assetId: 'tm-1' },
    },
  ]);
  const assets = [{ id: 'tm-1', type: 'testimonial', title: 'T', body: 'B' }];
  const issues = getMergedFluxPageConfigSemanticIssues(merged, assets);
  assert.deepEqual(issues, []);
});

test('benefits empty item title fails', () => {
  const merged = page([
    {
      id: 'b1',
      type: 'benefits',
      order: 0,
      props: {
        heading: 'Why us',
        items: [{ title: '', description: 'D' }],
      },
    },
  ]);
  const issues = getMergedFluxPageConfigSemanticIssues(merged, []);
  assert.ok(issues.some((s) => /items\[0\]\.title is empty/.test(s)));
});

test('formatMergedFluxSemanticIssuesForRepair caps length', () => {
  const long = Array.from({ length: 50 }, (_, i) => `issue number ${i} with some padding text`);
  const s = formatMergedFluxSemanticIssuesForRepair(long, 120);
  assert.ok(s.length <= 121);
  assert.ok(s.endsWith('…'));
});
