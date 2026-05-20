import test from 'node:test';
import assert from 'node:assert/strict';
import { enrichThemeConfig, resolveFluxHeaderAppearance } from './enrichThemeConfig.js';

test('enrichThemeConfig fills semantic palette from brand colors', () => {
  const theme = enrichThemeConfig({
    primaryColor: '#4f46e5',
    accentColor: '#10b981',
    backgroundColor: '#f5f5f5',
    textColor: '#1a1a1a',
    fontFamily: 'Inter',
  });
  assert.equal(theme.surfaceColor, '#ffffff');
  assert.equal(theme.errorColor, '#b91c1c');
  assert.match(theme.mutedTextColor, /^#[0-9a-f]{8}$/i);
  assert.ok(theme.onPrimaryColor === '#ffffff' || theme.onPrimaryColor === '#1a1a1a');
});

test('resolveFluxHeaderAppearance defaults from surface and border', () => {
  const theme = enrichThemeConfig({ primaryColor: '#4f46e5' });
  const header = resolveFluxHeaderAppearance(theme);
  assert.equal(header.backgroundColor, theme.surfaceColor);
  assert.equal(header.borderColor, theme.borderColor);
});
