import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { industryLineFromIndustry, roleLineFromTier } from './personalizationFields.js';

describe('personalizationFields', () => {
  it('maps tiers to role_line with trailing comma+space', () => {
    assert.equal(roleLineFromTier('webinar_fill'), "since you're on the hook for filling seats, ");
    assert.equal(roleLineFromTier('executive'), '');
    assert.equal(roleLineFromTier('unknown'), '');
  });

  it('maps known industries to industry_line with leading space', () => {
    assert.equal(industryLineFromIndustry('marketing & advertising'), ' in marketing');
    assert.equal(industryLineFromIndustry('health, wellness & fitness'), ' in health & wellness');
    assert.equal(industryLineFromIndustry('tobacco'), '');
    assert.equal(industryLineFromIndustry(''), '');
  });
});
