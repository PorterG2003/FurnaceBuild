import test from 'node:test';
import assert from 'node:assert/strict';
import { enrichThemeConfig } from './enrichThemeConfig.js';
import { mergeGeneratedPageConfigWithTemplate, parseTemplateBlocksForMerge } from './mergeGeneratedPageConfig.js';
import type { FluxGeneratePageConfigParsed } from './fluxGeneratePageConfigSchema.js';

test('mergeGeneratedPageConfigWithTemplate preserves quiz_and_book structure while merging visible copy', () => {
  const templateBlock = {
    id: 'qb1',
    type: 'quiz_and_book' as const,
    order: 0,
    props: {
      heading: 'Original heading',
      subheading: 'Original subheading',
      questions: [
        {
          id: 'q1',
          type: 'single_select' as const,
          prompt: 'Original prompt',
          options: [
            { id: 'o1', label: 'Original option one' },
            { id: 'o2', label: 'Original option two' },
          ],
        },
      ],
      summaryHeading: 'Original summary',
      summaryBody: 'Original body',
      calendlyUrl: 'https://calendly.com/original/event',
      destinationEmail: 'owner@example.com',
    },
  };

  const merged = mergeGeneratedPageConfigWithTemplate({
    templateBlocks: [templateBlock],
    llmPageConfig: {
      theme: {
        primaryColor: '#111111',
        accentColor: '#222222',
        backgroundColor: '#ffffff',
        textColor: '#000000',
        fontFamily: 'Inter',
        blockStylePreset: 'classic',
      },
      prospectName: 'Pat',
      companyName: 'Co',
      blocks: [
        {
          id: 'qb1',
          type: 'quiz_and_book',
          order: 0,
          props: {
            heading: 'Updated heading',
            subheading: 'Updated subheading',
            questions: [
              {
                id: 'q1',
                type: 'single_select',
                prompt: 'Updated prompt',
                options: [
                  { id: 'o1', label: 'Updated option one' },
                  { id: 'o2', label: 'Updated option two' },
                ],
              },
            ],
            summaryHeading: 'Updated summary',
            summaryBody: 'Updated body',
            calendlyUrl: 'https://calendly.com/changed/event',
            destinationEmail: 'changed@example.com',
          },
        },
      ],
    },
    serverTheme: {
      primaryColor: '#111111',
      accentColor: '#222222',
      backgroundColor: '#ffffff',
      textColor: '#000000',
      fontFamily: 'Inter',
    },
    prospectName: 'Pat',
    companyName: 'Co',
  });

  const block = merged.blocks[0];
  assert.equal(block?.type, 'quiz_and_book');
  if (block?.type === 'quiz_and_book') {
    assert.equal(block.props.heading, 'Updated heading');
    assert.equal(block.props.questions[0]?.prompt, 'Updated prompt');
    assert.equal(block.props.questions[0]?.options?.[0]?.label, 'Updated option one');
    assert.equal(block.props.calendlyUrl, 'https://calendly.com/original/event');
    assert.equal(block.props.destinationEmail, 'owner@example.com');
    assert.equal(block.props.questions[0]?.id, 'q1');
    assert.equal(block.props.questions[0]?.options?.[0]?.id, 'o1');
  }
});

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
  assert.deepEqual(merged.theme, enrichThemeConfig({ ...serverTheme }));
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

test('mergeGeneratedPageConfigWithTemplate preserves block appearance and theme header', () => {
  const serverTheme = {
    primaryColor: '#4f46e5',
    accentColor: '#4f46e5',
    backgroundColor: '#f5f5f5',
    textColor: '#1a1a1a',
    fontFamily: 'Inter',
    surfaceColor: '#ffffff',
    onPrimaryColor: '#ffffff',
    onSurfaceColor: '#1a1a1a',
    mutedTextColor: '#1a1a1aad',
    borderColor: '#4f46e530',
    strongBorderColor: '#4f46e540',
    errorColor: '#b91c1c',
    shadowColor: '#0f172a',
  };
  const templateBlocks = [
    {
      id: 'hero-1',
      type: 'hero',
      order: 0,
      props: { headline: 'Old', subheadline: 'Sub', ctaText: 'Go', ctaUrl: 'https://x.com' },
    },
  ];
  const llm: FluxGeneratePageConfigParsed = {
    theme: { primaryColor: '#000', accentColor: '#000', backgroundColor: '#fff', textColor: '#000', fontFamily: 'Inter' },
    prospectName: 'New Name',
    companyName: 'New Co',
    blocks: [
      {
        id: 'hero-1',
        type: 'hero',
        order: 0,
        props: { headline: 'New', subheadline: 'Sub2', ctaText: 'Go', ctaUrl: 'https://x.com' },
      },
    ],
  };
  const existingPageConfig = {
    theme: { ...serverTheme, header: { backgroundColor: '#eeeeee', borderColor: '#cccccc' } },
    prospectName: 'Old',
    companyName: 'Old Co',
    blocks: [
      {
        id: 'hero-1',
        type: 'hero' as const,
        order: 0,
        appearance: { panelSurfaceColor: '#aabbcc' },
        props: { headline: 'Old', subheadline: 'Sub', ctaText: 'Go', ctaUrl: 'https://x.com' },
      },
    ],
  };
  const merged = mergeGeneratedPageConfigWithTemplate({
    templateBlocks,
    llmPageConfig: llm,
    serverTheme,
    prospectName: 'New Name',
    companyName: 'New Co',
    existingPageConfig,
  });
  assert.equal(merged.theme.header?.backgroundColor, '#eeeeee');
  assert.equal(merged.blocks[0].appearance?.panelSurfaceColor, '#aabbcc');
  if (merged.blocks[0].type === 'hero') assert.equal(merged.blocks[0].props.headline, 'New');
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
