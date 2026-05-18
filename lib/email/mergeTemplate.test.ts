import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  extractMalformedVariables,
  extractVariableKeys,
  hasMissingValues,
  mergeTemplate,
  type LeadLike,
} from './mergeTemplate.js';

const lead: LeadLike = {
  first_name: 'Casey',
  last_name: 'Ng',
  company_name: 'Acme',
  custom_lead_data: {
    region: 'West',
    nested: {
      owner: 'Jordan',
    },
  },
};

describe('mergeTemplate', () => {
  it('merges top-level and nested custom variables', () => {
    const result = mergeTemplate(
      'Hi {{ first_name }}, {{custom.region}} is owned by {{custom.nested.owner}} at {{company_name}}.',
      lead
    );

    assert.equal(result, 'Hi Casey, West is owned by Jordan at Acme.');
  });

  it('replaces missing values with empty strings', () => {
    const result = mergeTemplate('Hi {{middle_name}} from {{custom.missing}}.', lead);

    assert.equal(result, 'Hi  from .');
  });
});

describe('extractVariableKeys', () => {
  it('deduplicates and trims variables across multiple inputs', () => {
    const result = extractVariableKeys(
      'Hi {{ first_name }}',
      'Welcome to {{company_name}}',
      'Again {{first_name}} and {{ custom.region }}'
    );

    assert.deepEqual(result.sort(), ['company_name', 'custom.region', 'first_name']);
  });
});

describe('hasMissingValues', () => {
  it('detects missing top-level and custom values', () => {
    assert.equal(hasMissingValues(lead, ['first_name', 'custom.region']), false);
    assert.equal(hasMissingValues(lead, ['first_name', 'custom.missing']), true);
    assert.equal(hasMissingValues({ ...lead, first_name: '   ' }, ['first_name']), true);
  });
});

describe('extractMalformedVariables', () => {
  it('finds single-brace variables without flagging valid variables', () => {
    const result = extractMalformedVariables('Good {{first_name}} bad {first_name}');

    assert.deepEqual(result, ['{first_name}']);
  });
});
