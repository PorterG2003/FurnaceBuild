import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractNameCandidatesFromPost,
  isNoisyCompanyCandidate,
  trimWebinarForPhrase,
} from './postCompanySignals.js';

describe('postCompanySignals', () => {
  it('extracts EOS Worldwide from webinar-for phrase', () => {
    const text =
      'Only 2 days left to register for our webinar for Professional and Certified EOS Worldwide Implementers on May 28th.';
    const names = extractNameCandidatesFromPost(text);
    assert.ok(names.some((n) => n.includes('EOS Worldwide')));
  });

  it('extracts company from title-role parenthetical', () => {
    const text =
      'The session will be led by Donna Scaffidi (Head of Legal Innovation, Ruli AI) and Lori Mininger (VP of Legal, Matic).';
    const names = extractNameCandidatesFromPost(text);
    assert.ok(names.some((n) => n.includes('Ruli AI')));
    assert.ok(names.some((n) => n.includes('Matic')));
  });

  it('rejects webinar marketing noise as company names', () => {
    assert.equal(isNoisyCompanyCandidate('Only 2 days left to register for our webinar'), true);
    assert.equal(isNoisyCompanyCandidate('Sarah Irwin'), true);
    assert.equal(isNoisyCompanyCandidate('EOS Worldwide'), false);
  });

  it('extracts co-host company from join pattern', () => {
    const text = 'In just one hour, Toreon and OX Security will welcome you to a webinar on CRA.';
    const names = extractNameCandidatesFromPost(text);
    assert.ok(names.some((n) => n.includes('Toreon') || n.includes('OX Security')));
  });

  it('trimWebinarForPhrase yields shorter company tail', () => {
    const variants = trimWebinarForPhrase('Professional and Certified EOS Worldwide Implementers');
    assert.ok(variants.some((v) => v === 'EOS Worldwide'));
  });
});
