import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveFluxPageLogoUrl, shouldSyncFluxPageConfigLogo, syncFluxPageConfigLogo } from './syncFluxPageConfigLogo.js';
import type { PageConfig } from './types.js';

const basePageConfig: PageConfig = {
  theme: {
    primaryColor: '#428d87',
    accentColor: '#000000',
    backgroundColor: '#f0f6f5',
    textColor: '#1a1a1a',
    fontFamily: 'Inter',
    logoUrl: 'https://stale.example/logo.png',
  },
  prospectName: 'Ryan Ellsworth',
  companyName: 'Summit Foot and Ankle',
  blocks: [],
};

test('resolveFluxPageLogoUrl prefers seller logo for merge branding', () => {
  const logoUrl = resolveFluxPageLogoUrl({
    prospectBrand: { primaryColor: '#111111', logoUrl: 'https://prospect.example/logo.png' },
    sellerBrand: { primaryColor: '#222222', logoUrl: 'https://seller.example/logo.png' },
    brandingPolicy: { v: 1, pageTheme: 'merge' },
  });
  assert.equal(logoUrl, 'https://seller.example/logo.png');
});

test('syncFluxPageConfigLogo rewrites stale saved logo with resolved branding logo', () => {
  const synced = syncFluxPageConfigLogo(basePageConfig, {
    prospectBrand: { primaryColor: '#111111', logoUrl: 'https://prospect.example/logo.png' },
    sellerBrand: { primaryColor: '#222222', logoUrl: 'https://seller.example/logo.png' },
    brandingPolicy: { v: 1, pageTheme: 'merge' },
  });
  assert.equal(synced.theme.logoUrl, 'https://seller.example/logo.png');
  assert.equal(synced.theme.primaryColor, '#428d87');
});

test('syncFluxPageConfigLogo removes stale logo when resolved branding has none', () => {
  const synced = syncFluxPageConfigLogo(basePageConfig, {
    prospectBrand: { primaryColor: '#111111' },
    sellerBrand: { primaryColor: '#222222' },
    brandingPolicy: { v: 1, pageTheme: 'merge' },
  });
  assert.equal(synced.theme.logoUrl, undefined);
});

test('shouldSyncFluxPageConfigLogo is false for a manual page override', () => {
  assert.equal(
    shouldSyncFluxPageConfigLogo(
      {
        ...basePageConfig,
        theme: { ...basePageConfig.theme, logoUrl: 'https://page.example/custom-logo.png' },
      },
      {
        prospectBrand: { primaryColor: '#111111', logoUrl: 'https://prospect.example/logo.png' },
        sellerBrand: { primaryColor: '#222222', logoUrl: 'https://seller.example/logo.png' },
        brandingPolicy: { v: 1, pageTheme: 'merge' },
      },
    ),
    false,
  );
});

test('syncFluxPageConfigLogo preserves a manual page override when guarded', () => {
  const synced = syncFluxPageConfigLogo(
    {
      ...basePageConfig,
      theme: { ...basePageConfig.theme, logoUrl: 'https://page.example/custom-logo.png' },
    },
    {
      prospectBrand: { primaryColor: '#111111', logoUrl: 'https://next-prospect.example/logo.png' },
      sellerBrand: { primaryColor: '#222222', logoUrl: 'https://next-seller.example/logo.png' },
      brandingPolicy: { v: 1, pageTheme: 'merge' },
    },
    {
      onlyIfCurrentMatches: {
        prospectBrand: { primaryColor: '#111111', logoUrl: 'https://prospect.example/logo.png' },
        sellerBrand: { primaryColor: '#222222', logoUrl: 'https://seller.example/logo.png' },
        brandingPolicy: { v: 1, pageTheme: 'merge' },
      },
    },
  );
  assert.equal(synced.theme.logoUrl, 'https://page.example/custom-logo.png');
});

test('syncFluxPageConfigLogo updates an auto-derived page logo when guarded', () => {
  const synced = syncFluxPageConfigLogo(
    {
      ...basePageConfig,
      theme: { ...basePageConfig.theme, logoUrl: 'https://seller.example/logo.png' },
    },
    {
      prospectBrand: { primaryColor: '#111111', logoUrl: 'https://next-prospect.example/logo.png' },
      sellerBrand: { primaryColor: '#222222', logoUrl: 'https://next-seller.example/logo.png' },
      brandingPolicy: { v: 1, pageTheme: 'merge' },
    },
    {
      onlyIfCurrentMatches: {
        prospectBrand: { primaryColor: '#111111', logoUrl: 'https://prospect.example/logo.png' },
        sellerBrand: { primaryColor: '#222222', logoUrl: 'https://seller.example/logo.png' },
        brandingPolicy: { v: 1, pageTheme: 'merge' },
      },
    },
  );
  assert.equal(synced.theme.logoUrl, 'https://next-seller.example/logo.png');
});
