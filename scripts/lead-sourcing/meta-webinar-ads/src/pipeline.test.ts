import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_CONFIG } from './config.js';
import { buildSearchUrl, classifyPageState } from './collector.js';
import { parseCard, parseMetaBodyText, type CardSnapshot } from './parser.js';
import { adDedupeKey, applyReviewDecisions, buildAdvertiserRows, normalizeAndFilter } from './pipeline.js';
import type { RawAd } from './types.js';

const query = { phrase: 'free webinar', searchUrl: 'https://example.test', collectedAt: '2026-08-10T00:00:00.000Z' };

function raw(overrides: Partial<RawAd> = {}): RawAd {
  return {
    platform: 'meta',
    adId: '1234567890',
    advertiserName: 'Acme Security',
    advertiserUrl: 'https://www.facebook.com/acmesecurity',
    payerName: null,
    primaryText: 'Reserve your spot for our free live webinar with Dana Reed.',
    headline: 'Register now',
    landingUrl: 'https://events.acme.com/webinar/response',
    detailUrl: 'https://www.facebook.com/ads/library/?id=1234567890',
    creativeImageUrls: [],
    activeFrom: 'August 1, 2026',
    activeTo: null,
    status: 'active',
    query,
    extraction: { source: 'fixture', confidence: 'high', rawText: 'fixture' },
    ...overrides,
  };
}

test('search URL encodes phrase and country', () => {
  const url = new URL(buildSearchUrl('free webinar', 'US'));
  assert.equal(url.searchParams.get('q'), 'free webinar');
  assert.equal(url.searchParams.get('country'), 'US');
  assert.equal(url.searchParams.get('active_status'), 'active');
  assert.equal(url.searchParams.get('search_type'), 'keyword_exact_phrase');
});

test('page state distinguishes ready, empty, and blocked', () => {
  assert.equal(classifyPageState('Loading…', 0), 'pending');
  assert.equal(classifyPageState('No ads match your search', 0), 'no_results');
  assert.equal(classifyPageState('Log in to Facebook to continue', 0), 'blocked');
  assert.equal(classifyPageState('Library ID: 123', 1), 'ready');
});

test('body parser extracts library id, page, and copy', () => {
  const body = [
    '1 result',
    'Library ID: 1234567890',
    'Started running on August 1, 2026',
    'See ad details',
    'Acme Security',
    'Sponsored',
    'Reserve your spot for our free live webinar with Dana Reed.',
    'events.acme.com',
    'Sign Up',
    'Active',
  ].join('\n');
  const parsed = parseMetaBodyText(body);
  assert.equal(parsed.cards.length, 1);
  assert.equal(parsed.cards[0]?.libraryId, '1234567890');
  assert.equal(parsed.cards[0]?.pageName, 'Acme Security');
  assert.match(parsed.cards[0]?.primaryText ?? '', /live webinar/i);
});

test('parser maps snapshot into raw ad with Ad Library detail URL', () => {
  const snapshot: CardSnapshot = {
    libraryId: '1234567890',
    pageName: 'Acme Security',
    pageUrl: 'https://www.facebook.com/acmesecurity',
    primaryText: 'Join our free webinar',
    headline: 'Register',
    landingUrl: 'https://events.acme.com/webinar',
    cta: 'Sign Up',
    startedRunning: 'August 1, 2026',
    linkUrls: ['https://events.acme.com/webinar'],
    rawText: 'fixture',
  };
  const ad = parseCard(snapshot, query, 'fixture');
  assert.equal(ad?.adId, '1234567890');
  assert.equal(ad?.detailUrl, 'https://www.facebook.com/ads/library/?id=1234567890');
  assert.equal(ad?.platform, 'meta');
});

test('live online webinars qualify and info-product noise is excluded', () => {
  const live = raw();
  const noise = raw({
    adId: '999',
    advertiserName: 'Cash Coach',
    primaryText: 'Make money online with my coaching program. Reserve your spot today.',
  });
  const normalized = normalizeAndFilter([live, noise], DEFAULT_CONFIG);
  assert.equal(normalized.find((ad) => ad.adId === '1234567890')?.disposition, 'qualified');
  assert.equal(normalized.find((ad) => ad.adId === '999')?.disposition, 'excluded');
  assert.ok(normalized.find((ad) => ad.adId === '999')?.exclusionReasons.includes('info_product_or_consumer_noise'));
  const advertisers = buildAdvertiserRows(normalized);
  assert.equal(advertisers.length, 1);
});

test('seat language alone is excluded and human keep overrides', () => {
  const weak = normalizeAndFilter([raw({ primaryText: 'Reserve your spot — limited seats remaining.' })], DEFAULT_CONFIG);
  assert.equal(weak[0]?.disposition, 'excluded');
  const kept = applyReviewDecisions(weak, [{ adId: weak[0]!.adId, dedupeKey: weak[0]!.dedupeKey, decision: 'keep' }]);
  assert.equal(kept[0]?.disposition, 'qualified');
});

test('dedupe key prefers library id', () => {
  assert.equal(adDedupeKey(raw()), 'id:1234567890');
  assert.equal(adDedupeKey(raw({ adId: null })).startsWith('fp:'), true);
});
