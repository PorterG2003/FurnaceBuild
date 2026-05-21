import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { blockSchema } from './schemas';
import { caseStudyLayoutUsesImage } from './fluxPresentationTokens';

describe('caseStudyLayoutUsesImage', () => {
  test('elevated and classic presets use image layouts', () => {
    assert.equal(caseStudyLayoutUsesImage('elevated'), true);
    assert.equal(caseStudyLayoutUsesImage('classic'), true);
  });

  test('minimal and soft presets do not use image layouts', () => {
    assert.equal(caseStudyLayoutUsesImage('minimal'), false);
    assert.equal(caseStudyLayoutUsesImage('soft'), false);
  });
});

describe('case_study block schema', () => {
  test('accepts overrideImageUrl on props', () => {
    const parsed = blockSchema.parse({
      id: 'b1',
      type: 'case_study',
      order: 0,
      props: {
        assetId: 'cs-1',
        overrideImageUrl: 'https://cdn.example/photo.jpg',
      },
    });
    assert.equal(parsed.type, 'case_study');
    if (parsed.type === 'case_study') {
      assert.equal(parsed.props.overrideImageUrl, 'https://cdn.example/photo.jpg');
    }
  });

  test('accepts imageFit on hero and case study props', () => {
    const hero = blockSchema.parse({
      id: 'hero-1',
      type: 'hero',
      order: 0,
      props: {
        headline: 'Headline',
        subheadline: 'Subheadline',
        ctaText: 'Book now',
        ctaUrl: '#book',
        heroImageUrl: 'https://cdn.example/hero.jpg',
        imageFit: 'contain',
      },
    });
    assert.equal(hero.type, 'hero');
    if (hero.type === 'hero') {
      assert.equal(hero.props.imageFit, 'contain');
    }

    const caseStudy = blockSchema.parse({
      id: 'b2',
      type: 'case_study',
      order: 1,
      props: {
        assetId: 'cs-1',
        overrideImageUrl: 'https://cdn.example/photo.jpg',
        imageFit: 'cover',
      },
    });
    assert.equal(caseStudy.type, 'case_study');
    if (caseStudy.type === 'case_study') {
      assert.equal(caseStudy.props.imageFit, 'cover');
    }
  });
});
