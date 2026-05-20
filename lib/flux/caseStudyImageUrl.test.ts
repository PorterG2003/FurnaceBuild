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
});
