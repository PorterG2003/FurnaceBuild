import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { pickBestLinkedInCandidate, scoreLinkedInOrganic } from './discoverLinkedInUrls.js';

describe('discoverLinkedInUrls scoring', () => {
  it('scores matching person+company LinkedIn hit', () => {
    const s = scoreLinkedInOrganic('Sarah Chezbro', 'Texas Apartment Association', 'taa.org', {
      link: 'https://www.linkedin.com/in/sarah-chezbro',
      title: 'Sarah Chezbro - Texas Apartment Association | LinkedIn',
      snippet: 'Education Manager at Texas Apartment Association',
      position: 1,
    });
    assert.ok(s);
    assert.ok(s!.score >= 0.55);
    assert.match(s!.url, /linkedin\.com\/in\/sarah-chezbro/i);
  });

  it('rejects company pages', () => {
    const s = scoreLinkedInOrganic('Someone', 'Acme', 'acme.com', {
      link: 'https://www.linkedin.com/company/acme',
      title: 'Acme | LinkedIn',
    });
    assert.equal(s, null);
  });

  it('picks best among organics', () => {
    const best = pickBestLinkedInCandidate('Jane Doe', 'Acme Security', 'acme.com', [
      {
        link: 'https://www.linkedin.com/in/other-person',
        title: 'Other Person - Elsewhere',
        position: 1,
      },
      {
        link: 'https://www.linkedin.com/in/jane-doe-123',
        title: 'Jane Doe - Director at Acme Security',
        snippet: 'Jane Doe works at Acme',
        position: 2,
      },
    ]);
    assert.equal(best.status, 'candidate');
    assert.match(best.linkedin_url, /jane-doe/i);
  });
});
