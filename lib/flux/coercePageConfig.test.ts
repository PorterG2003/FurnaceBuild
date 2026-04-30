import test from 'node:test';
import assert from 'node:assert/strict';
import { canPublishFluxProspectPage } from './coercePageConfig.js';
import type { PageConfig } from './types.js';

const theme = {
  primaryColor: '#111111',
  accentColor: '#222222',
  backgroundColor: '#eeeeee',
  textColor: '#000000',
  fontFamily: 'Inter',
  blockStylePreset: 'classic' as const,
} as const;

function page(blocks: PageConfig['blocks']): PageConfig {
  return {
    theme,
    prospectName: 'Pat',
    companyName: 'Co',
    blocks,
  };
}

const ex = (i: number) => ({
  headline: `H${i}`,
  body: `B${i}`,
  sourceUrl: `https://adstransparency.google.com/advertiser/AR${i}/creative/CR${i}`,
});

const competitorRow = (name: string, mapUrl: string) => ({
  name,
  mapImageUrl: mapUrl,
  adsSummary: '2 active creatives; last shown Jan 2025.',
  examples: [ex(1), ex(2)],
});

test('canPublishFluxProspectPage is true when competitor_ad_audit is ready and complete', () => {
  const ok = canPublishFluxProspectPage(
    page([
      {
        id: 'h',
        type: 'hero',
        order: 0,
        props: {
          headline: 'Hi',
          subheadline: 'There',
          ctaText: 'Go',
          ctaUrl: 'https://example.com',
        },
      },
      {
        id: 'c',
        type: 'competitor_ad_audit',
        order: 1,
        props: {
          heading: 'Audit',
          status: 'ready',
          competitors: [
            competitorRow('A', 'https://maps.example/a.png'),
            competitorRow('B', 'https://maps.example/b.png'),
            competitorRow('C', 'https://maps.example/c.png'),
          ],
        },
      },
    ]),
  );
  assert.equal(ok, true);
});

test('canPublishFluxProspectPage is true when competitor_ad_audit is ready with one competitor', () => {
  const ok = canPublishFluxProspectPage(
    page([
      {
        id: 'h',
        type: 'hero',
        order: 0,
        props: {
          headline: 'Hi',
          subheadline: 'There',
          ctaText: 'Go',
          ctaUrl: 'https://example.com',
        },
      },
      {
        id: 'c',
        type: 'competitor_ad_audit',
        order: 1,
        props: {
          heading: 'Audit',
          status: 'ready',
          competitors: [competitorRow('OnlyOne', 'https://maps.example/a.png')],
        },
      },
    ]),
  );
  assert.equal(ok, true);
});

test('canPublishFluxProspectPage is false when competitor_ad_audit is pending', () => {
  const ok = canPublishFluxProspectPage(
    page([
      {
        id: 'h',
        type: 'hero',
        order: 0,
        props: {
          headline: 'Hi',
          subheadline: 'There',
          ctaText: 'Go',
          ctaUrl: 'https://example.com',
        },
      },
      {
        id: 'c',
        type: 'competitor_ad_audit',
        order: 1,
        props: {
          heading: 'Audit',
          status: 'pending',
          competitors: [],
        },
      },
    ]),
  );
  assert.equal(ok, false);
});
