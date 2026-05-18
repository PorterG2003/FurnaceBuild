import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { processSpintax } from './processSpintax.js';

describe('processSpintax', () => {
  it('returns the first option in deterministic mode and preserves variables for later merge', () => {
    const result = processSpintax(
      'Subject: {Hi {{first_name}}|Hello {{first_name}}} from {Austin|Dallas}',
      { deterministic: true }
    );

    assert.equal(result, 'Subject: Hi {{first_name}} from Austin');
  });

  it('resolves nested spintax iteratively', () => {
    const result = processSpintax('Open with {outer {one|two}|fallback}', {
      deterministic: true,
    });

    assert.equal(result, 'Open with outer one');
  });

  it('uses random selection when deterministic mode is disabled', () => {
    const originalRandom = Math.random;
    Math.random = () => 0.99;

    try {
      const result = processSpintax('Pick {first|second|third}');
      assert.equal(result, 'Pick third');
    } finally {
      Math.random = originalRandom;
    }
  });

  it('leaves malformed single-option braces unchanged', () => {
    assert.equal(processSpintax('Keep {literal} braces', { deterministic: true }), 'Keep {literal} braces');
  });

  it('handles multiple spintax segments in one string', () => {
    const result = processSpintax('{Hi|Hello} there, {friend|team}', {
      deterministic: true,
    });

    assert.equal(result, 'Hi there, friend');
  });
});
