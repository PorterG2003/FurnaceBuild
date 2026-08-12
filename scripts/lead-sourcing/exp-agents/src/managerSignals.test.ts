import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classifyManagerSignals } from './managerSignals.ts';

describe('manager signal classification', () => {
  it('does not treat a generic broker title as management', () => {
    assert.equal(classifyManagerSignals({ title: 'Broker/Realtor®' }).confidence, 'none');
  });

  it('treats designated brokerage and team leadership as high confidence', () => {
    assert.equal(
      classifyManagerSignals({ title: 'Designated Managing Broker, Illinois' }).confidence,
      'high',
    );
    assert.equal(
      classifyManagerSignals({ title: 'Associate Broker | Team Leader' }).confidence,
      'high',
    );
    assert.equal(
      classifyManagerSignals({
        description: 'Founder and team lead of The Randi Lynn Group.',
      }).confidence,
      'high',
    );
  });

  it('keeps an unqualified managing-broker title at medium confidence', () => {
    const result = classifyManagerSignals({ positionTypes: ['Managing Broker'] });
    assert.equal(result.confidence, 'medium');
    assert.deepEqual(result.categories, ['possible_brokerage_manager']);
  });

  it('does not infer current management from historical broker language or mentorship', () => {
    assert.equal(
      classifyManagerSignals({
        description: 'Named Managing Broker of the Year in 2007.',
      }).confidence,
      'none',
    );
    assert.equal(
      classifyManagerSignals({
        title: 'Certified Mentor',
        description: 'I enjoy coaching new agents.',
      }).confidence,
      'none',
    );
  });

  it('recognizes quantified agent-management language', () => {
    const result = classifyManagerSignals({
      description: 'I manage, coach, and support 1,400 agents across Illinois.',
    });
    assert.equal(result.confidence, 'high');
    assert.ok(result.categories.includes('agent_organization_leader'));
  });

  it('does not treat bare state-broker licenses or loose bio language as high confidence', () => {
    assert.equal(
      classifyManagerSignals({ title: 'WA State Broker' }).confidence,
      'none',
    );
    assert.equal(
      classifyManagerSignals({ title: 'Washington State Broker' }).confidence,
      'none',
    );
    assert.equal(
      classifyManagerSignals({
        title: 'CA DRE# 01454605',
        description: 'Mike found his stride working with Senior agents in the market.',
      }).confidence,
      'none',
    );
    assert.equal(
      classifyManagerSignals({
        description: 'I lead clients through every step of the team buying process.',
      }).confidence,
      'none',
    );
    assert.equal(
      classifyManagerSignals({
        description:
          'I am a proud president and founder of a non-profit organization advised by a team of professionals.',
      }).confidence,
      'none',
    );
    assert.equal(
      classifyManagerSignals({
        description: 'Founder of the Randi Lynn Team at eXp Realty.',
      }).confidence,
      'high',
    );
  });
});
