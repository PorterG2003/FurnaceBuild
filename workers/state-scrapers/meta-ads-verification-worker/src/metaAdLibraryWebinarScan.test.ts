import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { parseMetaAdLibraryBodyText, toMatchedAdPayload } from './metaAdLibraryParse.js';
import {
  buildWebinarScanSignals,
  filterRecentDomainMatchedAds,
  findWebinarAds,
  isAdWithinDays,
  isWebinarAd,
  parseStartedRunningDate,
  scoreWebinarAd,
} from './metaAdLibraryWebinarScan.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, 'fixtures', 'meta-ad-library');
const JUL_2026 = new Date('2026-07-10T12:00:00Z');

test('parseStartedRunningDate parses Meta started_running text', () => {
  const parsed = parseStartedRunningDate('Jul 6, 2026');
  assert.ok(parsed);
  assert.equal(parsed?.getFullYear(), 2026);
  assert.equal(parsed?.getMonth(), 6);
});

test('isAdWithinDays includes ads within rolling window', () => {
  const card = {
    page_name: 'Xtalks Webinars',
    page_id: '1',
    page_url: null,
    link_urls: ['https://xtalks.com/webinars/foo'],
    body_text: null,
    primary_text: 'Join our webinar',
    headline: null,
    landing_url: 'https://xtalks.com/webinars/foo',
    cta: 'Sign Up',
    started_running: 'Jul 6, 2026',
  };
  assert.equal(isAdWithinDays(card, 30, JUL_2026), true);
  assert.equal(isAdWithinDays(card, 30, new Date('2026-08-10T12:00:00Z')), false);
});

test('filterRecentDomainMatchedAds excludes old undated and off-domain ads', () => {
  const snapshot = parseMetaAdLibraryBodyText(readFileSync(join(fixturesDir, 'xtalks-body-sample.txt'), 'utf8'), 'xtalks.com');
  const recent = filterRecentDomainMatchedAds(snapshot.cards, 'xtalks.com', 30, JUL_2026);
  assert.equal(recent.length, 2);

  const oldCard = {
    ...snapshot.cards[0],
    started_running: 'Jan 1, 2025',
  };
  const offDomainCard = {
    ...snapshot.cards[0],
    landing_url: 'https://other.com/webinar',
    link_urls: ['https://other.com/webinar'],
    body_text: 'https://other.com/webinar',
  };
  const filtered = filterRecentDomainMatchedAds([oldCard, offDomainCard], 'xtalks.com', 30, JUL_2026);
  assert.equal(filtered.length, 0);
});

test('findWebinarAds classifies Xtalks fixture ads as webinars', () => {
  const snapshot = parseMetaAdLibraryBodyText(readFileSync(join(fixturesDir, 'xtalks-body-sample.txt'), 'utf8'), 'xtalks.com');
  const webinarAds = findWebinarAds(snapshot.cards, 'xtalks.com', 30, JUL_2026);
  assert.equal(webinarAds.length, 2);
  assert.ok(webinarAds.every((ad) => ad.webinar_signals.includes('url_webinar_path')));
  assert.equal(webinarAds[0].cta, 'Sign Up');
});

test('findWebinarAds does not classify Nike product ads as webinars', () => {
  const snapshot = parseMetaAdLibraryBodyText(readFileSync(join(fixturesDir, 'nike-body-sample.txt'), 'utf8'), 'nike.com');
  const webinarAds = findWebinarAds(snapshot.cards, 'nike.com', 30, JUL_2026);
  assert.equal(webinarAds.length, 0);
});

test('scoreWebinarAd treats webinar URL alone as sufficient', () => {
  const ad = toMatchedAdPayload({
    page_name: 'Acme',
    page_id: '1',
    page_url: null,
    link_urls: ['https://acme.com/webinars/foo'],
    body_text: null,
    primary_text: 'Learn more about our platform.',
    headline: null,
    landing_url: 'https://acme.com/webinars/foo',
    cta: 'Learn more',
    started_running: 'Jul 1, 2026',
  });
  const scored = scoreWebinarAd(ad);
  assert.ok(scored.signals.includes('url_webinar_path'));
  assert.equal(isWebinarAd(ad), true);
});

test('scoreWebinarAd detects webinar path in link_urls when landing_url is homepage', () => {
  const ad = toMatchedAdPayload({
    page_name: 'Xtalks Webinars',
    page_id: '1',
    page_url: null,
    link_urls: ['https://xtalks.com/', 'https://xtalks.com/webinars/foo/'],
    body_text: null,
    primary_text: 'Join us for insights.',
    headline: null,
    landing_url: 'https://xtalks.com/',
    cta: 'Sign Up',
    started_running: 'Jul 1, 2026',
  });
  const scored = scoreWebinarAd(ad);
  assert.ok(scored.signals.includes('url_webinar_path'));
  assert.equal(isWebinarAd(ad), true);
});

test('scoreWebinarAd ignores generic Sign Up without webinar copy', () => {
  const ad = toMatchedAdPayload({
    page_name: 'Shop',
    page_id: '2',
    page_url: null,
    link_urls: ['https://shop.com/sale'],
    body_text: null,
    primary_text: 'Big summer sale today only.',
    headline: null,
    landing_url: 'https://shop.com/sale',
    cta: 'Sign Up',
    started_running: 'Jul 1, 2026',
  });
  assert.equal(isWebinarAd(ad), false);
});

test('buildWebinarScanSignals returns scan summary block', () => {
  const snapshot = parseMetaAdLibraryBodyText(readFileSync(join(fixturesDir, 'xtalks-body-sample.txt'), 'utf8'), 'xtalks.com');
  const scan = buildWebinarScanSignals(snapshot, 'xtalks.com', 30, JUL_2026);
  assert.equal(scan.enabled, true);
  assert.equal(scan.days, 30);
  assert.equal(scan.scanned_card_count, 2);
  assert.equal(scan.recent_ad_count, 2);
  assert.equal(scan.webinar_ad_count, 2);
  assert.equal(scan.webinar_ads.length, 2);
  assert.equal(scan.pagination.initial_card_count, 2);
  assert.equal(scan.pagination.scanned_card_count, 2);
  assert.equal(scan.pagination.scroll_helped, false);
});
