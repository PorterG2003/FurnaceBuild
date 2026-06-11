import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeServerCompetitorAuditBlocksIntoDraft } from './mergeServerCompetitorAuditBlocks.js';
import type { PageConfig } from './types.js';

const theme = {
  primaryColor: '#111111',
  accentColor: '#222222',
  backgroundColor: '#eeeeee',
  textColor: '#000000',
  fontFamily: 'Inter',
  blockStylePreset: 'classic' as const,
};

function page(blocks: PageConfig['blocks']): PageConfig {
  return {
    theme,
    prospectName: 'Pat',
    companyName: 'Co',
    blocks,
  };
}

test('mergeServerCompetitorAuditBlocksIntoDraft keeps draft heading but refreshes server audit payload', () => {
  const draft = page([
    {
      id: 'hero',
      type: 'hero',
      order: 0,
      props: {
        headline: 'Draft hero',
        subheadline: 'Draft subheadline',
        ctaText: 'Go',
        ctaUrl: 'https://example.com',
      },
    },
    {
      id: 'audit',
      type: 'competitor_ad_audit',
      order: 1,
      props: {
        heading: 'Custom draft heading',
        status: 'running',
        competitors: [],
      },
    },
  ]);

  const server = page([
    {
      id: 'hero',
      type: 'hero',
      order: 0,
      props: {
        headline: 'Server hero',
        subheadline: 'Server subheadline',
        ctaText: 'Go',
        ctaUrl: 'https://example.com',
      },
    },
    {
      id: 'audit',
      type: 'competitor_ad_audit',
      order: 1,
      props: {
        heading: 'Server heading',
        status: 'ready',
        errorMessage: 'old error should be cleared',
        lastAuditAt: '2026-05-05T17:43:44.685Z',
        competitors: [
          {
            name: 'Winner HVAC',
            mapImageUrl: 'https://maps.example/winner.png',
            adsSummary: '2 active creatives; last shown May 2026.',
            examples: [
              {
                headline: 'Fix AC fast',
                body: 'Same-day HVAC service available.',
                sourceUrl: 'https://adstransparency.google.com/advertiser/AR1/creative/CR1',
              },
            ],
          },
        ],
      },
    },
  ]);

  const merged = mergeServerCompetitorAuditBlocksIntoDraft(draft, server);
  const auditBlock = merged.blocks[1];
  assert.equal(auditBlock.type, 'competitor_ad_audit');
  if (auditBlock.type !== 'competitor_ad_audit') return;

  assert.equal(auditBlock.props.heading, 'Custom draft heading');
  assert.equal(auditBlock.props.status, 'ready');
  assert.equal(auditBlock.props.lastAuditAt, '2026-05-05T17:43:44.685Z');
  assert.equal(auditBlock.props.competitors.length, 1);
  assert.equal(auditBlock.props.competitors[0]?.name, 'Winner HVAC');
});

test('mergeServerCompetitorAuditBlocksIntoDraft applies curated domain titles onto server competitor rows', () => {
  const draft = page([
    {
      id: 'audit',
      type: 'competitor_ad_audit',
      order: 0,
      props: {
        heading: 'Custom draft heading',
        status: 'ready',
        discoveryMode: 'curated_domains',
        curatedDomains: [
          { domain: 'yourcomfortfirst.com', name: 'Comfort First' },
          { domain: 'allphaseair.com', name: 'All-Phase Heating & Cooling' },
        ],
        competitors: [],
      },
    },
  ]);

  const server = page([
    {
      id: 'audit',
      type: 'competitor_ad_audit',
      order: 0,
      props: {
        heading: 'Server heading',
        status: 'ready',
        competitors: [
          {
            name: 'yourcomfortfirst.com',
            mapImageUrl: '',
            adsSummary: '40 ads',
            examples: [
              {
                headline: 'Ad',
                body: 'Body',
                sourceUrl: 'https://adstransparency.google.com/advertiser/AR1/creative/CR1',
              },
            ],
          },
        ],
      },
    },
  ]);

  const merged = mergeServerCompetitorAuditBlocksIntoDraft(draft, server);
  const auditBlock = merged.blocks[0];
  assert.equal(auditBlock.type, 'competitor_ad_audit');
  if (auditBlock.type !== 'competitor_ad_audit') return;
  assert.equal(auditBlock.props.competitors[0]?.name, 'Comfort First');
});
