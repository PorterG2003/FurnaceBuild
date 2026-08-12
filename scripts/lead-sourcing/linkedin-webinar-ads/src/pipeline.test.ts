import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_CONFIG } from './config.js';
import { buildSearchUrl, classifyPageState } from './collector.js';
import { parseCard, type CardSnapshot } from './parser.js';
import { adDedupeKey, applyReviewDecisions, buildAdvertiserRows, extractPerson, normalizeAndFilter } from './pipeline.js';
import type { RawAd } from './types.js';

const query = { phrase: 'reserve your spot', searchUrl: 'https://example.test', collectedAt: '2026-08-07T00:00:00.000Z' };

function raw(overrides: Partial<RawAd> = {}): RawAd {
  return {
    platform: 'linkedin',
    adId: '123456',
    advertiserName: 'Acme Security',
    advertiserUrl: 'https://www.linkedin.com/company/acme-security/',
    payerName: null,
    primaryText: 'Reserve your spot for our live webinar with Dana Reed.',
    headline: 'Respond faster',
    landingUrl: 'https://events.acme.com/webinar/response?utm_source=linkedin',
    detailUrl: null,
    creativeImageUrls: [],
    activeFrom: '2026-08-01',
    activeTo: null,
    status: 'active',
    query,
    extraction: { source: 'fixture', confidence: 'high', rawText: 'fixture' },
    ...overrides,
  };
}

test('search URL encodes phrase and country', () => {
  const url = new URL(buildSearchUrl('save your seat', 'US', 1, 30, new Date('2026-08-07T12:00:00Z')));
  assert.equal(url.searchParams.get('keyword'), 'save your seat');
  assert.equal(url.searchParams.get('countries'), 'US');
  assert.equal(url.searchParams.get('startdate'), '2026-07-07');
  assert.equal(url.searchParams.get('enddate'), '2026-08-06');
});

test('page state does not turn an unhydrated page into no results', () => {
  assert.equal(classifyPageState('Loading ads…'), 'pending');
  assert.equal(classifyPageState('No ads match your search'), 'no_results');
  assert.equal(classifyPageState('Verify you are human'), 'blocked');
});

test('parser reads stable attributes and landing URL', () => {
  const card: CardSnapshot = {
    text: 'Acme Security\nSponsored\nReserve your spot for our live webinar with Dana Reed.',
    links: [{ href: 'https://events.acme.com/webinar/response', text: 'Register' }],
    attributes: { 'data-ad-id': '123456', 'data-advertiser-name': 'Acme Security', 'data-landing-url': 'https://events.acme.com/webinar/response' },
  };
  const parsed = parseCard(card, query, 'fixture');
  assert.equal(parsed?.adId, '123456');
  assert.equal(parsed?.landingUrl, 'https://events.acme.com/webinar/response');
});

test('pipeline merges phrase provenance, excludes replay, and rolls up advertisers', () => {
  const live = raw();
  const duplicate = raw({ query: { ...query, phrase: 'save your seat' } });
  const replay = raw({
    adId: '654321',
    advertiserName: 'Replay Academy',
    primaryText: 'Watch our on-demand webinar replay now.',
    landingUrl: 'https://replay.example.com/webinar',
  });
  const normalized = normalizeAndFilter([live, duplicate, replay], DEFAULT_CONFIG);
  assert.equal(normalized.length, 2);
  assert.deepEqual(normalized.find((ad) => ad.adId === '123456')?.phrases, ['reserve your spot', 'save your seat']);
  assert.equal(normalized.find((ad) => ad.adId === '654321')?.disposition, 'excluded');
  const advertisers = buildAdvertiserRows(normalized);
  assert.equal(advertisers.length, 1);
  assert.equal(advertisers[0]?.person_name, 'Dana Reed');
});

test('fallback dedupe key is stable and person extraction retains evidence', () => {
  const ad = raw({ adId: null });
  assert.equal(adDedupeKey(ad), adDedupeKey(ad));
  assert.deepEqual(extractPerson('Join Maya Chen for a live webinar'), { name: 'Maya Chen', evidence: 'Join Maya Chen' });
});

test('human review decisions override automated filtering', () => {
  const excluded = normalizeAndFilter([raw({ primaryText: 'Watch our on-demand webinar replay now.' })], DEFAULT_CONFIG);
  const updated = applyReviewDecisions(excluded, [{ adId: '123456', dedupeKey: excluded[0]!.dedupeKey, decision: 'keep' }]);
  assert.equal(updated[0]?.disposition, 'qualified');
  assert.deepEqual(updated[0]?.exclusionReasons, ['human_keep']);
});

test('live online webinars qualify without B2B keyword gates', () => {
  const ads = normalizeAndFilter([raw({
    primaryText: 'Register for our National Economic Webinar today.',
    headline: '',
  })], DEFAULT_CONFIG);
  assert.equal(ads[0]?.disposition, 'qualified');
  assert.ok(ads[0]?.liveSignals.includes('online_event'));
});

test('seat language alone is not enough without an online event', () => {
  const ads = normalizeAndFilter([raw({
    primaryText: 'Reserve your spot — limited seats remaining.',
    headline: '',
  })], DEFAULT_CONFIG);
  assert.equal(ads[0]?.disposition, 'excluded');
  assert.ok(ads[0]?.exclusionReasons.includes('not_live_online_event'));
});

test('in-person events are excluded', () => {
  const ads = normalizeAndFilter([raw({
    primaryText: 'Sign up for our lunch and learn in Houston, TX. Scan the QR code to reserve your spot!',
  })], DEFAULT_CONFIG);
  assert.equal(ads[0]?.disposition, 'excluded');
  assert.ok(ads[0]?.exclusionReasons.includes('in_person_event'));
});

test('book-a-call and article promos are excluded', () => {
  const call = normalizeAndFilter([raw({ primaryText: 'Book a call with our team to learn more about AI.' })], DEFAULT_CONFIG);
  const article = normalizeAndFilter([raw({ primaryText: 'Read our latest cybersecurity article for security teams.' })], DEFAULT_CONFIG);
  assert.equal(call[0]?.disposition, 'excluded');
  assert.ok(call[0]?.exclusionReasons.includes('book_a_call'));
  assert.equal(article[0]?.disposition, 'excluded');
  assert.ok(article[0]?.exclusionReasons.includes('content_promo'));
});

test('consumer events are excluded even when the copy asks for reservations', () => {
  const ads = normalizeAndFilter([raw({
    primaryText: 'Reserve your spot for the concert tour coming to Fairfax. Tickets are limited.',
  })], DEFAULT_CONFIG);
  assert.equal(ads[0]?.disposition, 'excluded');
  assert.ok(ads[0]?.exclusionReasons.includes('consumer_event'));
});

test('short-link landing URLs do not merge unrelated advertisers', () => {
  const ads = normalizeAndFilter([
    raw({ adId: 'a', advertiserName: 'First Co', advertiserUrl: null, landingUrl: 'https://lnkd.in/first' }),
    raw({ adId: 'b', advertiserName: 'Second Co', advertiserUrl: null, landingUrl: 'https://lnkd.in/second' }),
  ], DEFAULT_CONFIG);
  assert.notEqual(ads[0]?.advertiserKey, ads[1]?.advertiserKey);
  assert.equal(extractPerson('Join top-performing financial advisors'), null);
});
