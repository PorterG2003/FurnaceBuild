import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { countriesFromCli, parseCliArgs } from './cli.ts';
import { validateSlicePayload } from './enumerate.ts';
import type { SearchAgent } from './types.ts';

function agent(id: string, state = 'TX'): SearchAgent {
  return {
    id,
    firstName: 'Test',
    lastName: 'Agent',
    city: 'Austin',
    state,
    photo: '',
    email: 'agent@example.com',
    phoneNumber: null,
    bio: '',
  };
}

describe('state/province enumeration', () => {
  it('is the default mode and runs CA before US', () => {
    assert.equal(parseCliArgs([]).legacyPrefixes, false);
    assert.deepEqual(countriesFromCli('both'), ['CA', 'US']);
  });

  it('accepts a complete deterministic page', () => {
    assert.doesNotThrow(() =>
      validateSlicePayload({
        agents: [agent('1'), agent('2')],
        count: 2,
        country: 'US',
        location: 'TX',
        from: 0,
        size: 100,
      }),
    );
  });

  it('rejects capped slices that require subdivision', () => {
    assert.throws(
      () =>
        validateSlicePayload({
          agents: [agent('1')],
          count: 10000,
          country: 'US',
          location: 'TX',
          from: 0,
          size: 100,
        }),
      /subdivide/,
    );
  });

  it('rejects short and wrong-location pages', () => {
    assert.throws(
      () =>
        validateSlicePayload({
          agents: [agent('1')],
          count: 2,
          country: 'US',
          location: 'TX',
          from: 0,
          size: 100,
        }),
      /short page/,
    );
    assert.throws(
      () =>
        validateSlicePayload({
          agents: [
            agent('1', 'CA'),
            agent('2', 'CA'),
            agent('3', 'CA'),
            agent('4', 'CA'),
            agent('5', 'CA'),
          ],
          count: 5,
          country: 'US',
          location: 'TX',
          from: 0,
          size: 100,
        }),
      /location mismatch/,
    );
  });
});
