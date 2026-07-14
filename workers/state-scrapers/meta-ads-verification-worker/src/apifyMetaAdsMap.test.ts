import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCountResults } from './apifyMetaAdsClient.js';
import {
  buildSearchTarget,
  mapApifyAdToCard,
  resolveApifyCompanyLookup,
  type ApifyMetaAdRecord,
} from './apifyMetaAdsMap.js';

const nikeAd: ApifyMetaAdRecord = {
  adArchiveID: '3948271054812',
  sourceUrl:
    'https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&media_type=all&q=nike.com&search_type=keyword_exact_phrase',
  pageID: '15087023444',
  pageName: 'Nike',
  adText: 'Just Do It. Shop the latest collection.',
  adCreativeBodies: ['Just Do It. Shop the latest collection.'],
  ctaDomain: 'nike.com',
  ctaHeadline: 'Shop the latest collection',
  startDate: '2024-11-01T00:00:00+0000',
};

test('parseCountResults reads totalCount from summary rows', () => {
  const counts = parseCountResults([
    {
      sourceUrl: 'https://www.facebook.com/ads/library/?q=nike.com',
      totalCount: 42,
    },
  ]);
  assert.equal(counts[0]?.totalCount, 42);
});

test('parseCountResults infers counts from ad rows when summary fields missing', () => {
  const counts = parseCountResults([
    {
      adArchiveID: '123',
      pageName: 'Nike',
      adText: 'Just Do It',
      sourceUrl: 'https://www.facebook.com/ads/library/?q=nike.com',
    },
  ]);
  assert.equal(counts[0]?.totalCount, 1);
});

test('mapApifyAdToCard maps Leadsbrary fields to internal card shape', () => {
  const card = mapApifyAdToCard(nikeAd);
  assert.equal(card.page_name, 'Nike');
  assert.equal(card.landing_url, 'https://nike.com');
  assert.equal(card.primary_text, 'Just Do It. Shop the latest collection.');
});

test('buildSearchTarget uses exact phrase for domains', () => {
  const target = buildSearchTarget('nike.com', 'nike.com', 'domain');
  assert.match(target.url, /search_type=keyword_exact_phrase/);
  assert.match(target.url, /q=nike\.com/);
});

test('resolveApifyCompanyLookup classifies domain-matched Nike ad as yes', () => {
  const lookup = resolveApifyCompanyLookup({
    searchDomain: 'nike.com',
    companyName: 'Nike',
    domainAds: [nikeAd],
    domainTotalCount: 1,
  });
  assert.equal(lookup.result, 'yes');
  assert.equal(lookup.matched_ad_count, 1);
  assert.equal(lookup.search_attempts.length, 1);
});

test('resolveApifyCompanyLookup returns no for empty results', () => {
  const lookup = resolveApifyCompanyLookup({
    searchDomain: 'commvault.com',
    companyName: 'Commvault',
    domainAds: [],
    domainTotalCount: 0,
    nameAds: [],
    nameTotalCount: 0,
  });
  assert.equal(lookup.result, 'no');
  assert.equal(lookup.matched_ad_count, 0);
  assert.equal(lookup.webinar_scan.webinar_ad_count, 0);
  assert.equal(lookup.webinar_scan.recent_ad_count, 0);
});
