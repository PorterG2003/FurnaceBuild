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
