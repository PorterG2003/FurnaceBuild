import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveFluxPageBrandInputs } from './resolveFluxPageBrandInputs.js';
import type { BrandProfile } from './types.js';

const prospect: BrandProfile = {
  primaryColor: '#111111',
  accentColor: '#222222',
  fontFamily: 'Inter',
  logoUrl: 'https://p.example/logo.png',
  blockStylePreset: 'classic',
};

const seller: BrandProfile = {
  primaryColor: '#333333',
  accentColor: '#444444',
  fontFamily: 'Georgia',
  logoUrl: 'https://s.example/logo.png',
  blockStylePreset: 'minimal',
};

test('pageTheme prospect uses prospect colors', () => {
  const r = resolveFluxPageBrandInputs({
    policy: { v: 1, pageTheme: 'prospect' },
    prospectBrand: prospect,
    sellerBrand: seller,
  });
  assert.equal(r.primaryColor, '#111111');
  assert.equal(r.logoUrl, 'https://p.example/logo.png');
});

test('pageTheme seller uses seller colors', () => {
  const r = resolveFluxPageBrandInputs({
    policy: { v: 1, pageTheme: 'seller' },
    prospectBrand: prospect,
    sellerBrand: seller,
  });
  assert.equal(r.primaryColor, '#333333');
  assert.equal(r.logoUrl, 'https://s.example/logo.png');
});

test('pageTheme merge defaults to prospect-first for colors and seller-first for logo', () => {
  const r = resolveFluxPageBrandInputs({
    policy: { v: 1, pageTheme: 'merge' },
    prospectBrand: prospect,
    sellerBrand: seller,
  });
  assert.equal(r.primaryColor, '#111111');
  assert.equal(r.logoUrl, 'https://s.example/logo.png');
});

test('logoFrom seller overrides merge', () => {
  const r = resolveFluxPageBrandInputs({
    policy: { v: 1, pageTheme: 'merge', logoFrom: 'seller' },
    prospectBrand: prospect,
    sellerBrand: seller,
  });
  assert.equal(r.logoUrl, 'https://s.example/logo.png');
});
