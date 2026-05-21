import test from 'node:test';
import assert from 'node:assert/strict';
import {
  pageConfigSchema,
  formatZodIssuesForRepair,
  normalizeFluxLlmPageConfigBeforeZod,
  normalizeTannersQualificationModeLiteral,
} from './fluxGeneratePageConfigSchema.js';

test('normalizeTannersQualificationModeLiteral maps active to reps', () => {
  assert.equal(normalizeTannersQualificationModeLiteral('active'), 'reps');
  assert.equal(normalizeTannersQualificationModeLiteral('Active'), 'reps');
  assert.equal(normalizeTannersQualificationModeLiteral('passive'), 'passive');
  assert.equal(normalizeTannersQualificationModeLiteral('str'), 'str');
  assert.equal(normalizeTannersQualificationModeLiteral('bogus'), undefined);
});

test('normalizeFluxLlmPageConfigBeforeZod fixes active so pageConfigSchema passes', () => {
  const raw = {
    theme: {
      primaryColor: '#111',
      accentColor: '#222',
      backgroundColor: '#eee',
      textColor: '#000',
      fontFamily: 'Inter',
    },
    prospectName: 'A',
    companyName: 'B',
    blocks: [
      {
        id: 'x',
        type: 'tanners_tax_strategy',
        order: 0,
        props: {
          heading: 'H',
          disclaimer: 'D',
          defaultQualificationMode: 'active',
        },
      },
    ],
  };
  const normalized = normalizeFluxLlmPageConfigBeforeZod(raw);
  const zr = pageConfigSchema.safeParse(normalized);
  assert.equal(zr.success, true);
  if (zr.success) {
    const b = zr.data.blocks[0];
    assert.equal(b?.type, 'tanners_tax_strategy');
    if (b?.type === 'tanners_tax_strategy') {
      assert.equal(b.props.defaultQualificationMode, 'reps');
    }
  }
});

test('formatZodIssuesForRepair summarizes paths', () => {
  const bad = pageConfigSchema.safeParse({ foo: 1 });
  assert.equal(bad.success, false);
  if (!bad.success) {
    const s = formatZodIssuesForRepair(bad.error, 500);
    assert.match(s, /required|invalid|theme|blocks/i);
  }
});

test('pageConfigSchema accepts social_media_plan block', () => {
  const raw = {
    theme: {
      primaryColor: '#111',
      accentColor: '#222',
      backgroundColor: '#eee',
      textColor: '#000',
      fontFamily: 'Inter',
    },
    prospectName: 'A',
    companyName: 'B',
    blocks: [
      {
        id: 'smp',
        type: 'social_media_plan',
        order: 0,
        props: {
          inferred_vertical: 'med spas',
          inferred_vertical_rationale: 'Site shows two med spa case studies.',
          positioning_summary: 'Clinical, results-first, no hype.',
          weeks: [
            {
              theme: 'Proof',
              days: [{ platform: 'IG', post_type: 'Reel', hook: 'Stop scrolling — one metric.', cta: 'Save' }],
            },
          ],
          cta_ladder: ['Follow', 'DM PLAN', 'Book'],
          platform_mix_note: 'IG for reach; TikTok for discovery.',
        },
      },
    ],
  };
  const zr = pageConfigSchema.safeParse(raw);
  assert.equal(zr.success, true);
  if (zr.success) {
    const b = zr.data.blocks[0];
    assert.equal(b?.type, 'social_media_plan');
  }
});

test('pageConfigSchema accepts image fit props on image blocks', () => {
  const raw = {
    theme: {
      primaryColor: '#111',
      accentColor: '#222',
      backgroundColor: '#eee',
      textColor: '#000',
      fontFamily: 'Inter',
    },
    prospectName: 'A',
    companyName: 'B',
    blocks: [
      {
        id: 'hero-1',
        type: 'hero',
        order: 0,
        props: {
          headline: 'Headline',
          subheadline: 'Subheadline',
          ctaText: 'Book',
          ctaUrl: '#book',
          heroImageUrl: 'https://cdn.example/hero.jpg',
          imageFit: 'contain',
        },
      },
      {
        id: 'audit-1',
        type: 'competitor_ad_audit',
        order: 1,
        props: {
          heading: 'Competitor ad audit',
          status: 'ready',
          mapImageFit: 'contain',
          exampleImageFit: 'cover',
          competitors: [
            {
              name: 'Acme',
              mapImageUrl: 'https://cdn.example/map.jpg',
              adsSummary: 'Most recent creative shown 2026-05-01.',
              examples: [
                {
                  headline: 'Headline',
                  body: 'Body',
                  sourceUrl: 'https://adstransparency.google.com/advertiser/123',
                  imageUrl: 'https://cdn.example/ad.jpg',
                },
              ],
            },
          ],
        },
      },
    ],
  };
  const zr = pageConfigSchema.safeParse(raw);
  assert.equal(zr.success, true);
});

test('pageConfigSchema accepts quiz_and_book block', () => {
  const raw = {
    theme: {
      primaryColor: '#111',
      accentColor: '#222',
      backgroundColor: '#eee',
      textColor: '#000',
      fontFamily: 'Inter',
    },
    prospectName: 'A',
    companyName: 'B',
    blocks: [
      {
        id: 'quiz-1',
        type: 'quiz_and_book',
        order: 0,
        props: {
          heading: 'A few quick questions',
          subheading: 'We will tailor the strategy before booking.',
          questions: [
            {
              id: 'q1',
              type: 'single_select',
              prompt: 'How many locations do you have?',
              options: [
                { id: 'o1', label: 'One' },
                { id: 'o2', label: 'Two or more' },
              ],
            },
          ],
          summaryHeading: 'Perfect.',
          summaryBody: 'Next step is scheduling a time to review the plan.',
          calendlyUrl: 'https://calendly.com/drfoottraffic/15min',
        },
      },
    ],
  };
  const zr = pageConfigSchema.safeParse(raw);
  assert.equal(zr.success, true);
  if (zr.success) {
    const b = zr.data.blocks[0];
    assert.equal(b?.type, 'quiz_and_book');
  }
});
