import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeLinkedInProfileUrl } from './pass5Prep.js';

describe('normalizeLinkedInProfileUrl', () => {
  it('normalizes www and trailing slash', () => {
    assert.equal(
      normalizeLinkedInProfileUrl('https://www.linkedin.com/in/jane-doe/'),
      'https://www.linkedin.com/in/jane-doe',
    );
  });

  it('accepts bare host without protocol', () => {
    assert.equal(
      normalizeLinkedInProfileUrl('linkedin.com/in/jane-doe'),
      'https://www.linkedin.com/in/jane-doe',
    );
  });

  it('rejects company pages and non-linkedin', () => {
    assert.equal(normalizeLinkedInProfileUrl('https://www.linkedin.com/company/acme'), '');
    assert.equal(normalizeLinkedInProfileUrl('https://example.com/in/jane'), '');
  });
});
