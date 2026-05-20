import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractCreativeDisplayFromInnerText,
  pickSamplesForDisplay,
  TRANSPARENCY_CREATIVE_FALLBACK_BODY,
  TRANSPARENCY_CREATIVE_FALLBACK_HEADLINE,
  type TransparencyScannedCreative,
} from './transparencyCreativeDisplay.js';

test('extractCreativeDisplayFromInnerText strips Transparency chrome and keeps ad lines', () => {
  const fixture = `
Ads Transparency Center
Sign in
Home
keyboard_arrow_right
APEX Service Partners, LLC
keyboard_arrow_right
Ad details
FAQ
Ad details
APEX Service Partners, LLC
The information about this ad may vary by location
Shown in the United States
close
Last shown: Apr 29, 2026
Format: Text
flag
Report this ad
Save 15% on furnace tune-ups this spring
Call now for same-day service in Washington County
`.trim();

  const { headline, body } = extractCreativeDisplayFromInnerText(fixture);
  assert.equal(headline, 'APEX Service Partners, LLC');
  assert.match(body, /Save 15%/);
  assert.match(body, /Washington County/);
});

test('extractCreativeDisplayFromInnerText returns fallback when only chrome', () => {
  const { headline, body } = extractCreativeDisplayFromInnerText(
    'Ads Transparency Center\nSign in\nHome\nkeyboard_arrow_right\n',
  );
  assert.equal(headline, TRANSPARENCY_CREATIVE_FALLBACK_HEADLINE);
  assert.equal(body, TRANSPARENCY_CREATIVE_FALLBACK_BODY);
});

test('extractCreativeDisplayFromInnerText drops Transparency footer junk and dedupes adjacent lines', () => {
  const fixture = `
Last shown: Apr 28, 2026
Quality Air Service
Quality Air Service
Jarib Guzman-Perez flag PrinciplesAds Blog
Save 15% on tune-ups this week
`.trim();
  const { headline, body } = extractCreativeDisplayFromInnerText(fixture);
  assert.equal(headline, 'Quality Air Service');
  assert.match(body, /Save 15%/);
  assert.doesNotMatch(body, /PrinciplesAds/i);
  assert.doesNotMatch(body, /flag Principles/i);
});

test('pickSamplesForDisplay prefers creatives matching global latest date', () => {
  const scanned: TransparencyScannedCreative[] = [
    {
      sourceUrl: 'https://adstransparency.google.com/creative/old',
      headline: 'Old',
      body: 'Old body',
      latestAdLastShownAt: '2026-01-01',
      firstAdShownAt: '2025-01-01',
      runDays: 10,
    },
    {
      sourceUrl: 'https://adstransparency.google.com/creative/new',
      headline: 'New',
      body: 'New body',
      latestAdLastShownAt: '2026-04-29',
      firstAdShownAt: '2026-03-01',
      runDays: 59,
    },
    {
      sourceUrl: 'https://adstransparency.google.com/creative/new2',
      headline: 'New2',
      body: 'New2 body',
      latestAdLastShownAt: '2026-04-29',
      firstAdShownAt: '2025-06-01',
      runDays: 300,
    },
  ];
  const globalLatest = '2026-04-29';
  const out = pickSamplesForDisplay(scanned, globalLatest, 2);
  assert.equal(out.length, 2);
  assert.equal(out[0].headline, 'New2');
  assert.equal(out[1].headline, 'New');
});

test('pickSamplesForDisplay dedupes by sourceUrl', () => {
  const scanned: TransparencyScannedCreative[] = [
    {
      sourceUrl: 'https://example.com/c1',
      headline: 'A',
      body: 'B',
      latestAdLastShownAt: '2026-04-01',
      firstAdShownAt: null,
      runDays: null,
    },
    {
      sourceUrl: 'https://example.com/c1',
      headline: 'Dup',
      body: 'Dup',
      latestAdLastShownAt: '2026-04-01',
      firstAdShownAt: null,
      runDays: null,
    },
  ];
  const out = pickSamplesForDisplay(scanned, '2026-04-01', 2);
  assert.equal(out.length, 1);
});

test('pickSamplesForDisplay preserves previewPng on picked rows', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  const scanned: TransparencyScannedCreative[] = [
    {
      sourceUrl: 'https://adstransparency.google.com/creative/a',
      headline: 'H',
      body: 'B',
      latestAdLastShownAt: '2026-04-01',
      firstAdShownAt: null,
      runDays: null,
      previewPng: png,
    },
  ];
  const out = pickSamplesForDisplay(scanned, '2026-04-01', 2);
  assert.equal(out.length, 1);
  assert.ok(out[0].previewPng);
  assert.deepEqual(out[0].previewPng, png);
});

test('pickSamplesForDisplay prefers screenshot-bearing rows over previewless rows', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  const scanned: TransparencyScannedCreative[] = [
    {
      sourceUrl: 'https://adstransparency.google.com/creative/no-preview',
      headline: 'No preview',
      body: 'No preview body',
      latestAdLastShownAt: '2026-05-14',
      firstAdShownAt: '2026-05-01',
      runDays: 13,
    },
    {
      sourceUrl: 'https://adstransparency.google.com/creative/with-preview',
      headline: 'With preview',
      body: 'With preview body',
      latestAdLastShownAt: '2026-05-13',
      firstAdShownAt: '2026-05-01',
      runDays: 12,
      previewPng: png,
    },
  ];
  const out = pickSamplesForDisplay(scanned, '2026-05-14', 1);
  assert.equal(out.length, 1);
  assert.equal(out[0].headline, 'With preview');
  assert.deepEqual(out[0].previewPng, png);
});

test('pickSamplesForDisplay still falls back to previewless rows when none have screenshots', () => {
  const scanned: TransparencyScannedCreative[] = [
    {
      sourceUrl: 'https://adstransparency.google.com/creative/a',
      headline: 'A',
      body: 'A body',
      latestAdLastShownAt: '2026-05-14',
      firstAdShownAt: '2026-05-01',
      runDays: 13,
    },
    {
      sourceUrl: 'https://adstransparency.google.com/creative/b',
      headline: 'B',
      body: 'B body',
      latestAdLastShownAt: '2026-05-13',
      firstAdShownAt: '2026-05-01',
      runDays: 12,
    },
  ];
  const out = pickSamplesForDisplay(scanned, '2026-05-14', 1);
  assert.equal(out.length, 1);
  assert.equal(out[0].headline, 'A');
});

test('pickSamplesForDisplay restricts output to one advertiser when requiredAdvertiserId is provided', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  const scanned: TransparencyScannedCreative[] = [
    {
      sourceUrl:
        'https://adstransparency.google.com/advertiser/AR11550926466527002625/creative/CR06891629215205031937?region=US',
      headline: 'Jerome Dean',
      body: 'Ad funded by: jerome dean info',
      latestAdLastShownAt: '2026-05-18',
      firstAdShownAt: '2026-05-01',
      runDays: 17,
      previewPng: png,
    },
    {
      sourceUrl:
        'https://adstransparency.google.com/advertiser/AR00365012073437986817/creative/CR08847700258315042817?region=US',
      headline: 'Hype Consulting LLC',
      body: 'View the full creative on Google Ads Transparency (link below).',
      latestAdLastShownAt: '2026-05-18',
      firstAdShownAt: '2026-05-01',
      runDays: 17,
      previewPng: png,
    },
  ];
  const out = pickSamplesForDisplay(scanned, '2026-05-18', 2, {
    requiredAdvertiserId: 'AR11550926466527002625',
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].headline, 'Jerome Dean');
});
