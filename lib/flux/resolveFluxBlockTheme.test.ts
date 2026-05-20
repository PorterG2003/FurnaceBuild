import test from 'node:test';
import assert from 'node:assert/strict';
import { enrichThemeConfig } from './enrichThemeConfig.js';
import { getFluxBlockPresentation, mergeThemeWithBlockAppearance } from './resolveFluxBlockTheme.js';

test('mergeThemeWithBlockAppearance overrides section and panel colors', () => {
  const base = enrichThemeConfig({
    primaryColor: '#4f46e5',
    backgroundColor: '#f5f5f5',
    textColor: '#1a1a1a',
    fontFamily: 'Inter',
  });
  const merged = mergeThemeWithBlockAppearance(base, {
    sectionBackgroundColor: '#112233',
    panelSurfaceColor: '#aabbcc',
  });
  assert.equal(merged.backgroundColor, '#112233');
  const presentation = getFluxBlockPresentation(base, {
    panelSurfaceColor: '#aabbcc',
  });
  assert.equal(presentation.panelCard.backgroundColor, '#aabbcc');
});

test('headingColor does not override body textColor on theme merge', () => {
  const base = enrichThemeConfig({
    primaryColor: '#4f46e5',
    textColor: '#1a1a1a',
    fontFamily: 'Inter',
  });
  const merged = mergeThemeWithBlockAppearance(base, { headingColor: '#ff0000' });
  assert.equal(merged.textColor, '#1a1a1a');
  const presentation = getFluxBlockPresentation(base, { headingColor: '#ff0000' });
  assert.equal(presentation.headingColor, '#ff0000');
  assert.equal(presentation.textColor, '#1a1a1a');
});

test('mutedTextColor override is exposed for hero subheadline', () => {
  const base = enrichThemeConfig({ primaryColor: '#4f46e5', textColor: '#1a1a1a', fontFamily: 'Inter' });
  const presentation = getFluxBlockPresentation(base, { mutedTextColor: '#aabbcc' });
  assert.equal(presentation.hasMutedTextColorOverride, true);
  assert.equal(presentation.mutedTextColor, '#aabbcc');
});
