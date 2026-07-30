import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isThreadContinuingSubject,
  normalizeStoredEmailSubject,
  resolveCampaignFollowUpSubject,
} from './followUpSubject.js';

const lead = { id: 'lead-1', email: 'lead@example.com', first_name: 'Casey' };

describe('isThreadContinuingSubject', () => {
  it('treats empty and whitespace as continuing', () => {
    assert.equal(isThreadContinuingSubject(''), true);
    assert.equal(isThreadContinuingSubject('   '), true);
    assert.equal(isThreadContinuingSubject(null), true);
    assert.equal(isThreadContinuingSubject(undefined), true);
  });

  it('treats the No subject placeholder as continuing', () => {
    assert.equal(isThreadContinuingSubject('(No subject)'), true);
    assert.equal(isThreadContinuingSubject('(no subject)'), true);
    assert.equal(isThreadContinuingSubject('  (No subject)  '), true);
  });

  it('treats real subjects as non-continuing', () => {
    assert.equal(isThreadContinuingSubject('Quick question'), false);
    assert.equal(isThreadContinuingSubject('Re: Quick question'), false);
  });
});

describe('normalizeStoredEmailSubject', () => {
  it('returns empty for blank and placeholder inputs', () => {
    assert.equal(normalizeStoredEmailSubject(''), '');
    assert.equal(normalizeStoredEmailSubject('   '), '');
    assert.equal(normalizeStoredEmailSubject(null), '');
    assert.equal(normalizeStoredEmailSubject(undefined), '');
    assert.equal(normalizeStoredEmailSubject('(No subject)'), '');
    assert.equal(normalizeStoredEmailSubject('(no subject)'), '');
  });

  it('preserves real subjects trimmed', () => {
    assert.equal(normalizeStoredEmailSubject('  Quick question  '), 'Quick question');
  });
});

describe('resolveCampaignFollowUpSubject', () => {
  it('reuses exact firstSentSubject when current subject is continuing', () => {
    const originalRandom = Math.random;
    Math.random = () => 0.99;
    try {
      const subject = resolveCampaignFollowUpSubject({
        currentSubject: '',
        firstSentSubject: 'Quick Eval and Draft Question',
        firstSubjectTemplate: '{Alpha {{first_name}}|Beta {{first_name}}|Gamma {{first_name}}}',
        lead,
      });
      assert.equal(subject, 'Quick Eval and Draft Question');
    } finally {
      Math.random = originalRandom;
    }
  });

  it('treats (No subject) like empty and reuses firstSentSubject', () => {
    const subject = resolveCampaignFollowUpSubject({
      currentSubject: '(No subject)',
      firstSentSubject: 'Quick question',
      firstSubjectTemplate: '{A|B|C}',
      lead,
    });
    assert.equal(subject, 'Quick question');
  });

  it('falls back to deterministic template render when firstSentSubject is missing', () => {
    const a = resolveCampaignFollowUpSubject({
      currentSubject: '',
      firstSentSubject: null,
      firstSubjectTemplate: '{Alpha {{first_name}}|Beta {{first_name}}|Gamma {{first_name}}}',
      lead,
    });
    const b = resolveCampaignFollowUpSubject({
      currentSubject: '',
      firstSentSubject: undefined,
      firstSubjectTemplate: '{Alpha {{first_name}}|Beta {{first_name}}|Gamma {{first_name}}}',
      lead,
    });
    assert.equal(a, b);
    assert.match(a, /^(Alpha|Beta|Gamma) Casey$/);
  });

  it('leaves intentional non-empty subjects unchanged', () => {
    const subject = resolveCampaignFollowUpSubject({
      currentSubject: 'Brand new subject',
      firstSentSubject: 'Quick question',
      firstSubjectTemplate: '{A|B}',
      lead,
    });
    assert.equal(subject, 'Brand new subject');
  });
});
