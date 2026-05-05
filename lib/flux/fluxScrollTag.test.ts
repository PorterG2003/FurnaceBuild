import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeFluxScrollTagToDomId,
  parseInPageScrollTargetFromCtaUrl,
  computeResolvedAnchorDomIdByBlockId,
} from './fluxScrollTag.js';
import type { Block } from './types.js';

test('normalizeFluxScrollTagToDomId slugifies and strips hash', () => {
  assert.equal(normalizeFluxScrollTagToDomId('  Case Study! '), 'case-study');
  assert.equal(normalizeFluxScrollTagToDomId('#Pricing'), 'pricing');
  assert.equal(normalizeFluxScrollTagToDomId('9lives'), 's-9lives');
  assert.equal(normalizeFluxScrollTagToDomId(''), null);
  assert.equal(normalizeFluxScrollTagToDomId('!!!'), null);
});

test('parseInPageScrollTargetFromCtaUrl only accepts safe hash-only URLs', () => {
  assert.equal(parseInPageScrollTargetFromCtaUrl('#results'), 'results');
  assert.equal(parseInPageScrollTargetFromCtaUrl(' #Case-Study '), 'case-study');
  assert.equal(parseInPageScrollTargetFromCtaUrl('https://x.com#y'), null);
  assert.equal(parseInPageScrollTargetFromCtaUrl('#//evil'), null);
  assert.equal(parseInPageScrollTargetFromCtaUrl(''), null);
});

test('computeResolvedAnchorDomIdByBlockId dedupes duplicate tags', () => {
  const blocks: Block[] = [
    {
      id: 'a1',
      type: 'hero',
      order: 0,
      scrollTag: 'x',
      props: { headline: 'h', subheadline: 's', ctaText: 'c', ctaUrl: 'https://example.com' },
    },
    {
      id: 'b2',
      type: 'cta',
      order: 1,
      scrollTag: 'x',
      props: { headline: 'h', ctaText: 'c', ctaUrl: 'https://example.com' },
    },
  ];
  const m = computeResolvedAnchorDomIdByBlockId(blocks);
  assert.equal(m.get('a1'), 'x');
  assert.equal(m.get('b2'), 'x-b2');
});
