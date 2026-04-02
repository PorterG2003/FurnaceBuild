import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  buildOwnerQueryKey,
  buildRegistryEntityKey,
  classifyOwnerName,
  ownerResolutionStatusForSeed,
} from './index.js';

describe('owner drilldown helpers', () => {
  it('classifies strong organization markers as entity', () => {
    const result = classifyOwnerName('Wasatch Holdings LLC');
    assert.equal(result.kind, 'entity');
  });

  it('classifies person-shaped names as person', () => {
    const result = classifyOwnerName('Jane Q Smith');
    assert.equal(result.kind, 'person');
  });

  it('leaves weak signals as unknown', () => {
    const result = classifyOwnerName('Sunrise');
    assert.equal(result.kind, 'unknown');
  });

  it('marks entity owners beyond depth max as max depth reached', () => {
    const status = ownerResolutionStatusForSeed({
      kind: 'entity',
      discoveryDepth: 5,
      depthMax: 4,
    });
    assert.equal(status, 'max_depth_reached');
  });

  it('builds stable query and registry keys', () => {
    assert.equal(buildOwnerQueryKey('UT', 'Wasatch Holdings LLC'), 'UT:wasatch_holdings');
    assert.equal(buildRegistryEntityKey('FL', 'L07000048547'), 'FL:L07000048547');
  });
});
