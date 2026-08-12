import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CallCounter } from '../../webinar-hosts/src/lib/callCounter.js';
import {
  extractHeadlineOrgWithLlm,
  parseHeadlineOrgFromLlmContent,
} from './llmHeadlineOrg.js';

describe('parseHeadlineOrgFromLlmContent', () => {
  it('parses JSON organizationName', () => {
    const hints = parseHeadlineOrgFromLlmContent(
      '{"title":"Principal","organizationName":"Goshen High School"}',
    );
    assert.equal(hints.title, 'Principal');
    assert.equal(hints.organizationName, 'Goshen High School');
  });

  it('rejects non-school organization names', () => {
    const hints = parseHeadlineOrgFromLlmContent(
      '{"title":"Coach","organizationName":"Acme Consulting LLC"}',
    );
    assert.equal(hints.organizationName, '');
  });
});

describe('isWeakOrganizationHint', () => {
  it('flags orgs starting with and/of and twitter handles', async () => {
    const { isWeakOrganizationHint } = await import('./llmHeadlineOrg.js');
    assert.equal(isWeakOrganizationHint('and Instruction Clearview Local Schools'), true);
    assert.equal(isWeakOrganizationHint('Clearview Local Schools @PaulKish'), true);
    assert.equal(isWeakOrganizationHint('Clearview Local Schools'), false);
  });
});

describe('extractHeadlineOrgWithLlm fixtures', () => {
  it('extracts Clearview Local Schools from buried headline', async () => {
    const counter = new CallCounter();
    const hints = await extractHeadlineOrgWithLlm(
      'Director of Curriculum and Instruction Clearview Local Schools @PaulKish',
      { useFixtures: true, counter },
    );
    assert.equal(hints.organizationName, 'Clearview Local Schools');
    assert.equal(counter.counts.openrouter_calls, 1);
  });

  it('returns empty org for title-only headlines', async () => {
    const hints = await extractHeadlineOrgWithLlm('3-5 Principal', { useFixtures: true });
    assert.equal(hints.organizationName, '');
    assert.equal(hints.title, 'Principal');
  });
});
