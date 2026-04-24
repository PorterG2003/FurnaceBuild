import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeGeneratedPageConfigWithTemplate, parseTemplateBlocksForMerge } from './mergeGeneratedPageConfig.js';
import type { FluxGeneratePageConfigParsed } from './fluxGeneratePageConfigSchema.js';

const serverTheme = {
  primaryColor: '#111111',
  accentColor: '#222222',
  backgroundColor: '#eeeeee',
  textColor: '#000000',
  fontFamily: 'Inter',
} as const;

test('merge preserves template order and ids; applies LLM props when id+type match', () => {
  const templateBlocks = [
    {
      id: 'a',
      type: 'hero',
      order: 0,
      props: { headline: 'T', subheadline: 'S', ctaText: 'Go', ctaUrl: '/' },
    },
    {
      id: 'b',
      type: 'cta',
      order: 1,
      props: { headline: 'CtaT', ctaText: 'Book', ctaUrl: '/x' },
    },
  ];

  const llm: FluxGeneratePageConfigParsed = {
    theme: {
      primaryColor: '#bad',
      accentColor: '#bad',
      backgroundColor: '#bad',
      textColor: '#bad',
      fontFamily: 'Comic Sans MS',
    },
    prospectName: 'wrong',
    companyName: 'wrong',
    blocks: [
      {
        id: 'wrong-id',
        type: 'hero',
        order: 99,
        props: { headline: 'X', subheadline: 'Y', ctaText: 'Z', ctaUrl: '/z' },
      },
      {
        id: 'a',
        type: 'hero',
        order: 0,
        props: { headline: 'New', subheadline: 'Sub', ctaText: 'Go2', ctaUrl: '/p' },
      },
      {
        id: 'b',
        type: 'cta',
        order: 1,
        props: { headline: 'Final', ctaText: 'T', ctaUrl: '/t' },
      },
    ],
  };

  const merged = mergeGeneratedPageConfigWithTemplate({
    templateBlocks,
    llmPageConfig: llm,
    serverTheme,
    prospectName: 'Jane',
    companyName: 'Acme',
  });

  assert.equal(merged.prospectName, 'Jane');
  assert.equal(merged.companyName, 'Acme');
  assert.deepEqual(merged.theme, serverTheme);
  assert.equal(merged.blocks.length, 2);
  assert.equal(merged.blocks[0].id, 'a');
  assert.equal(merged.blocks[0].type, 'hero');
  if (merged.blocks[0].type === 'hero') {
    assert.equal(merged.blocks[0].props.headline, 'New');
    assert.equal(merged.blocks[0].props.ctaUrl, '/p');
  }
  assert.equal(merged.blocks[1].id, 'b');
  if (merged.blocks[1].type === 'cta') {
    assert.equal(merged.blocks[1].props.headline, 'Final');
  }
});

test('merge keeps template block when LLM has no matching id', () => {
  const templateBlocks = [
    {
      id: 'only',
      type: 'hero',
      order: 0,
      props: { headline: 'Keep', subheadline: '', ctaText: 'Go', ctaUrl: '/' },
    },
  ];
  const llm: FluxGeneratePageConfigParsed = {
    theme: serverTheme as FluxGeneratePageConfigParsed['theme'],
    prospectName: 'x',
    companyName: 'y',
    blocks: [],
  };
  const merged = mergeGeneratedPageConfigWithTemplate({
    templateBlocks,
    llmPageConfig: llm,
    serverTheme,
    prospectName: 'P',
    companyName: 'C',
  });
  assert.equal(merged.blocks.length, 1);
  if (merged.blocks[0].type === 'hero') assert.equal(merged.blocks[0].props.headline, 'Keep');
});

test('parseTemplateBlocksForMerge sorts by order', () => {
  const raw = [
    { id: '2', type: 'hero', order: 1, props: { headline: 'b', subheadline: '', ctaText: 'x', ctaUrl: '/' } },
    { id: '1', type: 'hero', order: 0, props: { headline: 'a', subheadline: '', ctaText: 'x', ctaUrl: '/' } },
  ];
  const sorted = parseTemplateBlocksForMerge(raw);
  assert.equal(sorted[0].id, '1');
  assert.equal(sorted[1].id, '2');
});
