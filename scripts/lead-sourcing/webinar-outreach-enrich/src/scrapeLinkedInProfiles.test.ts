import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseSerperLinkedInTitle } from './scrapeLinkedInProfiles.js';

describe('parseSerperLinkedInTitle', () => {
  it('parses Name - Title at Company | LinkedIn', () => {
    const p = parseSerperLinkedInTitle(
      'Sarah Chezbro - Education Manager at Texas Apartment Association | LinkedIn',
    );
    assert.equal(p.headline, 'Education Manager');
    assert.equal(p.company, 'Texas Apartment Association');
  });

  it('handles title without at-company', () => {
    const p = parseSerperLinkedInTitle('Jane Doe - Founder & CEO | LinkedIn');
    assert.equal(p.headline, 'Founder & CEO');
    assert.equal(p.company, '');
  });
});
