import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  buildMetaAdLibrarySearchUrl,
  pickSearchTypeForTerm,
} from './metaAdLibraryUrl.js';
import {
  classifyMetaAdResults,
  domainMatchesResult,
  extractStructuredAdContentFromBlock,
  isInconclusiveClassification,
  META_ADS_MAX_MATCHED_ADS,
  parseMetaAdLibraryBodyText,
  parseMetaAdLibraryHtml,
  pickMatchedAdsForSignals,
  scorePageNameMatch,
} from './metaAdLibraryParse.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, 'fixtures', 'meta-ad-library');

function loadFixture(name: string): string {
  return readFileSync(join(fixturesDir, name), 'utf8');
}

test('buildMetaAdLibrarySearchUrl encodes q, country, and search_type', () => {
  const url = buildMetaAdLibrarySearchUrl({
    q: 'acme.com',
    country: 'US',
    searchType: 'keyword_unordered',
  });
  assert.match(url, /^https:\/\/www\.facebook\.com\/ads\/library\/\?/);
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get('q'), 'acme.com');
  assert.equal(parsed.searchParams.get('country'), 'US');
  assert.equal(parsed.searchParams.get('search_type'), 'keyword_unordered');
  assert.equal(parsed.searchParams.get('active_status'), 'active');
});

test('pickSearchTypeForTerm uses exact phrase for multi-word names and domains', () => {
  assert.equal(pickSearchTypeForTerm('Acme Plumbing'), 'keyword_exact_phrase');
  assert.equal(pickSearchTypeForTerm('acme.com'), 'keyword_exact_phrase');
  assert.equal(pickSearchTypeForTerm('Nike'), 'keyword_unordered');
});

test('domainMatchesResult matches host and subdomain', () => {
  assert.equal(domainMatchesResult('acme.com', 'https://www.acme.com/services'), true);
  assert.equal(domainMatchesResult('acme.com', 'https://shop.acme.com/'), true);
  assert.equal(domainMatchesResult('acme.com', 'https://other.com'), false);
  assert.equal(
    domainMatchesResult(
      'xtalks.com',
      'HTTPS://XTALKS.COM/WEBINARS/predict-bsab-liabilities/?utm_source=social',
    ),
    true,
  );
});

test('scorePageNameMatch prefers exact normalized equality', () => {
  assert.equal(scorePageNameMatch('Prairie Home Services LLC', 'Prairie Home Services LLC'), 1);
  assert.ok(scorePageNameMatch('Acme Plumbing LLC', 'Acme Plumbing LLC') >= 0.85);
  assert.ok(scorePageNameMatch('Acme Plumbing', 'Totally Different Co') < 0.85);
});

test('classifyMetaAdResults returns yes when domain match present', () => {
  const snapshot = parseMetaAdLibraryHtml(loadFixture('domain-match.html'), 'Ad Library');
  const out = classifyMetaAdResults({
    searchDomain: 'acmeplumbing.com',
    snapshot,
  });
  assert.equal(out.result, 'yes');
  assert.equal(out.matched_via, 'domain_url');
  assert.equal(out.matched_card?.page_name, 'Acme Plumbing LLC');
});

test('classifyMetaAdResults returns no on empty results', () => {
  const snapshot = parseMetaAdLibraryHtml(loadFixture('no-results.html'), 'Ad Library');
  const out = classifyMetaAdResults({
    searchDomain: 'acmeplumbing.com',
    snapshot,
  });
  assert.equal(out.result, 'no');
  assert.equal(out.reason, 'no_results');
});

test('classifyMetaAdResults returns unknown on ambiguous multi-page results', () => {
  const snapshot = parseMetaAdLibraryHtml(loadFixture('ambiguous-results.html'), 'Ad Library');
  const out = classifyMetaAdResults({
    searchDomain: 'targetco.com',
    snapshot,
  });
  assert.equal(out.result, 'unknown');
  assert.equal(out.reason, 'unmatched_results_present');
});

test('classifyMetaAdResults uses page name fallback match', () => {
  const snapshot = parseMetaAdLibraryHtml(loadFixture('page-name-match.html'), 'Ad Library');
  const out = classifyMetaAdResults({
    searchDomain: 'prairiehomeservices.com',
    companyName: 'Prairie Home Services LLC',
    snapshot,
  });
  assert.equal(out.result, 'yes');
  assert.equal(out.matched_via, 'page_name');
});

test('classifyMetaAdResults returns yes for Xtalks-style ads with https URLs and same advertiser', () => {
  const snapshot = parseMetaAdLibraryBodyText(loadFixture('xtalks-body-sample.txt'));
  assert.equal(snapshot.cards.length, 2);
  assert.ok(snapshot.cards.every((card) => card.link_urls.some((url) => url.includes('xtalks.com'))));
  const out = classifyMetaAdResults({
    searchDomain: 'xtalks.com',
    companyName: 'Xtalks',
    snapshot,
  });
  assert.equal(out.result, 'yes');
  assert.equal(out.matched_via, 'domain_url');
  assert.equal(out.matched_card?.page_name, 'Xtalks Webinars');
  assert.equal(out.reason, 'multiple_domain_matches');
});

test('isInconclusiveClassification treats same-advertiser multi-ad yes as conclusive', () => {
  const snapshot = parseMetaAdLibraryBodyText(loadFixture('xtalks-body-sample.txt'));
  const out = classifyMetaAdResults({
    searchDomain: 'xtalks.com',
    companyName: 'Xtalks',
    snapshot,
  });
  assert.equal(out.result, 'yes');
  assert.equal(isInconclusiveClassification(out), false);
});

test('classifyMetaAdResults stays unknown when multiple different advertisers match by page name', () => {
  const snapshot = parseMetaAdLibraryBodyText(`
Library ID: 1
Started running on Jan 1, 2026
See ad details
Acme East
Sponsored
https://other.com
Library ID: 2
Started running on Jan 2, 2026
See ad details
Acme West
Sponsored
https://other2.com
  `);
  const out = classifyMetaAdResults({
    searchDomain: 'acme.com',
    companyName: 'Acme',
    snapshot,
  });
  assert.equal(out.result, 'unknown');
  assert.equal(out.reason, 'ambiguous_page_name_matches');
});

test('parseMetaAdLibraryBodyText extracts structured Xtalks ad content', () => {
  const snapshot = parseMetaAdLibraryBodyText(loadFixture('xtalks-body-sample.txt'), 'xtalks.com');
  const out = classifyMetaAdResults({
    searchDomain: 'xtalks.com',
    companyName: 'Xtalks',
    snapshot,
  });
  const matchedAds = pickMatchedAdsForSignals(snapshot, 'xtalks.com', out, 'Xtalks');
  assert.equal(matchedAds.length, 2);
  assert.equal(matchedAds[0].page_name, 'Xtalks Webinars');
  assert.equal(matchedAds[0].cta, 'Sign Up');
  assert.match(matchedAds[0].landing_url ?? '', /xtalks\.com/i);
  assert.match(matchedAds[0].primary_text ?? '', /bispecific antibodies/i);
  assert.match(matchedAds[1].primary_text ?? '', /healthy aging/i);
});

test('pickMatchedAdsForSignals caps at META_ADS_MAX_MATCHED_ADS and prefers domain matches', () => {
  const domainCards = Array.from({ length: 6 }, (_, i) => ({
    page_name: `Advertiser ${i}`,
    page_id: String(i + 1),
    page_url: null,
    link_urls: [`https://acme.com/page-${i}`],
    body_text: null,
    primary_text: `Ad copy ${i}`,
    headline: null,
    landing_url: `https://acme.com/page-${i}`,
    cta: 'Shop Now',
    started_running: null,
  }));
  const pageNameOnlyCard = {
    page_name: 'Acme Plumbing LLC',
    page_id: '99',
    page_url: null,
    link_urls: ['https://other.com'],
    body_text: null,
    primary_text: 'Other ad',
    headline: null,
    landing_url: 'https://other.com',
    cta: null,
    started_running: null,
  };
  const snapshot = {
    cards: [...domainCards, pageNameOnlyCard],
    no_results: false,
    blocker: null,
    body_text: '',
    page_title: null,
  };
  const classification = classifyMetaAdResults({
    searchDomain: 'acme.com',
    companyName: 'Acme Plumbing LLC',
    snapshot,
  });
  const matchedAds = pickMatchedAdsForSignals(snapshot, 'acme.com', classification, 'Acme Plumbing LLC');
  assert.equal(matchedAds.length, META_ADS_MAX_MATCHED_ADS);
  assert.ok(matchedAds.every((ad) => ad.landing_url?.includes('acme.com')));
});

test('pickMatchedAdsForSignals returns empty array when result is no', () => {
  const snapshot = parseMetaAdLibraryHtml(loadFixture('no-results.html'), 'Ad Library');
  const out = classifyMetaAdResults({
    searchDomain: 'acmeplumbing.com',
    snapshot,
  });
  assert.equal(out.result, 'no');
  assert.deepEqual(pickMatchedAdsForSignals(snapshot, 'acmeplumbing.com', out), []);
});

test('extractStructuredAdContentFromBlock parses primary text, URL, headline, and CTA', () => {
  const lines = [
    'See ad details',
    'Nike',
    'Sponsored',
    'Get the gear that goes hard on and off the field.',
    'NIKE.COM',
    'Nike Air Monarch IV',
    'Shop Now',
  ];
  const structured = extractStructuredAdContentFromBlock(lines, ['https://www.nike.com/'], 'nike.com');
  assert.match(structured.primary_text ?? '', /Get the gear/i);
  assert.match(structured.landing_url ?? '', /nike\.com/i);
  assert.equal(structured.headline, 'Nike Air Monarch IV');
  assert.equal(structured.cta, 'Shop Now');
});
