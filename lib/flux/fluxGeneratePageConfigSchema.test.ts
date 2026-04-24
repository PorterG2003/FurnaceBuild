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
