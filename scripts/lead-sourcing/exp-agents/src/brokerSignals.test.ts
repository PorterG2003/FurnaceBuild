import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  classifyBioBrokerSignals,
  classifyBrokerAudience,
  preferTier,
} from './brokerSignals.ts';

describe('broker audience tiers', () => {
  it('assigns tier A for explicit managers and C for generic brokers', () => {
    assert.equal(
      classifyBrokerAudience({ title: 'Designated Managing Broker' }).tier,
      'A',
    );
    assert.equal(
      classifyBrokerAudience({ title: 'Team Leader', positionTypes: ['REALTOR'] }).tier,
      'A',
    );
    assert.equal(classifyBrokerAudience({ title: 'Broker Associate' }).tier, 'C');
    assert.equal(classifyBrokerAudience({ title: 'REALTOR®' }).tier, 'none');
  });

  it('assigns tier B for unqualified managing broker titles', () => {
    const result = classifyBrokerAudience({ positionTypes: ['Managing Broker'] });
    assert.equal(result.tier, 'B');
    assert.equal(result.campaignSegment, 'possible_manager');
  });

  it('assigns tier D only for strict bio current-broker or manager language', () => {
    assert.equal(
      classifyBrokerAudience(
        { description: 'I am a licensed real estate broker in Texas.' },
        { bioOnly: true },
      ).tier,
      'D',
    );
    assert.equal(
      classifyBrokerAudience(
        { description: 'Named Managing Broker of the Year in 2007.' },
        { bioOnly: true },
      ).tier,
      'none',
    );
    assert.equal(
      classifyBrokerAudience(
        { description: 'Transactions brokered by eXp Realty.' },
        { bioOnly: true },
      ).tier,
      'none',
    );
  });

  it('prefers higher tiers deterministically', () => {
    assert.equal(preferTier('A', 'C'), 'A');
    assert.equal(preferTier('D', 'B'), 'B');
    assert.equal(preferTier('C', 'C'), 'C');
  });

  it('detects bio current-broker phrases without treating mentor language as a hit', () => {
    const hit = classifyBioBrokerSignals('Currently a Managing Broker serving Austin.');
    assert.equal(hit.isCurrentBroker, true);
    const miss = classifyBioBrokerSignals('I enjoy coaching new agents as a certified mentor.');
    assert.equal(miss.isCurrentBroker, false);
    assert.equal(miss.isManagerish, false);
  });
});
