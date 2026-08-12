import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { pickCtaHref } from './rehydrateLandings.js';

describe('pickCtaHref', () => {
  it('prefers CTA-labeled external links over first external', () => {
    const href = pickCtaHref([
      { href: 'https://facebook.com/x', text: 'Facebook' },
      { href: 'https://brand.example.com/about', text: 'About' },
      { href: 'https://brand.example.com/webinar', text: 'Register Now' },
    ]);
    assert.equal(href, 'https://brand.example.com/webinar');
  });

  it('falls back to first external when no CTA text', () => {
    const href = pickCtaHref([
      { href: 'https://linkedin.com/company/x', text: 'Company' },
      { href: 'https://events.acme.com/r', text: 'acme' },
    ]);
    assert.equal(href, 'https://events.acme.com/r');
  });

  it('returns empty when only platform links', () => {
    assert.equal(
      pickCtaHref([{ href: 'https://www.facebook.com/ads/library/?id=1', text: 'Library' }]),
      '',
    );
  });

  it('unwraps l.facebook.com destinations and prefers webinar CTA', () => {
    const href = pickCtaHref([
      { href: 'https://metastatus.com/ads-transparency', text: 'Meta Status' },
      {
        href: 'https://l.facebook.com/l.php?u=https%3A%2F%2Facehandymanfranchising.com%2Ffranchise-webinar%2F&h=AT',
        text: 'Free Franchise Webinar\nRegister Now',
      },
      {
        href: 'https://l.facebook.com/l.php?u=https%3A%2F%2Facehandymanfranchising.com%2F&h=AT',
        text: 'Learn More',
      },
    ]);
    assert.equal(href, 'https://acehandymanfranchising.com/franchise-webinar/');
  });
});
