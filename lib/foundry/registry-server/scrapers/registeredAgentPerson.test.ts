import assert from 'node:assert';
import { describe, it } from 'node:test';
import { eligibleIndividualRegisteredAgentName } from './registeredAgentPerson.js';

describe('eligibleIndividualRegisteredAgentName', () => {
  it('accepts a typical individual name', () => {
    assert.equal(eligibleIndividualRegisteredAgentName('Jane Marie Smith'), true);
    assert.equal(eligibleIndividualRegisteredAgentName('SMITH, JOHN A'), true);
  });

  it('rejects empty and corporate statutory shops', () => {
    assert.equal(eligibleIndividualRegisteredAgentName(''), false);
    assert.equal(eligibleIndividualRegisteredAgentName('   '), false);
    assert.equal(eligibleIndividualRegisteredAgentName('C T CORPORATION SYSTEM'), false);
    assert.equal(eligibleIndividualRegisteredAgentName('ACME HOLDINGS LLC'), false);
  });

  it('rejects single token names', () => {
    assert.equal(eligibleIndividualRegisteredAgentName('SMITH'), false);
  });
});
