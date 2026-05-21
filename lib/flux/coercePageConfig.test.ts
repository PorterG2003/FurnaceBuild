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

const ex = (advertiserId: string, creativeId: string) => ({
  headline: `H-${creativeId}`,
  body: `B-${creativeId}`,
  sourceUrl: `https://adstransparency.google.com/advertiser/${advertiserId}/creative/${creativeId}`,
});

const competitorRow = (name: string, mapUrl: string, advertiserId = 'AR11111111111111111111') => ({
  name,
  mapImageUrl: mapUrl,
  adsSummary: '2 active creatives; last shown Jan 2025.',
  examples: [ex(advertiserId, 'CR1'), ex(advertiserId, 'CR2')],
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
            competitorRow('A', 'https://maps.example/a.png', 'AR11111111111111111111'),
            competitorRow('B', 'https://maps.example/b.png', 'AR22222222222222222222'),
            competitorRow('C', 'https://maps.example/c.png', 'AR33333333333333333333'),
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

test('canPublishFluxProspectPage is false when one competitor row mixes advertiser ids', () => {
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
            {
              ...competitorRow('Anytime Fitness', 'https://maps.example/a.png'),
              examples: [
                ex('AR11550926466527002625', 'CR06891629215205031937'),
                ex('AR00365012073437986817', 'CR08847700258315042817'),
              ],
            },
          ],
        },
      },
    ]),
  );
  assert.equal(ok, false);
});

test('canPublishFluxProspectPage is false when two competitor rows share one advertiser id', () => {
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
            competitorRow('A', 'https://maps.example/a.png', 'AR05044827027778043905'),
            competitorRow('B', 'https://maps.example/b.png', 'AR05044827027778043905'),
          ],
        },
      },
    ]),
  );
  assert.equal(ok, false);
});

test('canPublishFluxProspectPage allows empty mapImageUrl in curated mode', () => {
  const ok = canPublishFluxProspectPage(
    page([
      {
        id: 'c',
        type: 'competitor_ad_audit',
        order: 0,
        props: {
          heading: 'Audit',
          discoveryMode: 'curated_domains',
          status: 'ready',
          competitors: [competitorRow('Visit Denver', '')],
        },
      },
    ]),
  );
  assert.equal(ok, true);
});

test('canPublishFluxProspectPage still requires mapImageUrl in local_places mode', () => {
  const ok = canPublishFluxProspectPage(
    page([
      {
        id: 'c',
        type: 'competitor_ad_audit',
        order: 0,
        props: {
          heading: 'Audit',
          discoveryMode: 'local_places',
          status: 'ready',
          competitors: [competitorRow('Visit Denver', '')],
        },
      },
    ]),
  );
  assert.equal(ok, false);
});
