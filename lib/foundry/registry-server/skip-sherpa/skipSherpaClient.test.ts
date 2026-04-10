import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  parsePersonResultsArray,
  skipSherpaPersonRowHasBillableHit,
} from './skipSherpaClient.js';

describe('skipSherpaClient', () => {
  it('parsePersonResultsArray returns empty for non-objects', () => {
    assert.deepStrictEqual(parsePersonResultsArray(null), []);
    assert.deepStrictEqual(parsePersonResultsArray(undefined), []);
    assert.deepStrictEqual(parsePersonResultsArray('x'), []);
    assert.deepStrictEqual(parsePersonResultsArray({}), []);
  });

  it('parsePersonResultsArray reads person_results', () => {
    const body = { person_results: [{ persons: [] }, { x: 1 }] };
    assert.deepStrictEqual(parsePersonResultsArray(body), [{ persons: [] }, { x: 1 }]);
  });

  it('skipSherpaPersonRowHasBillableHit requires 2xx and non-empty persons', () => {
    assert.equal(skipSherpaPersonRowHasBillableHit(200, { persons: [{ name: 'A' }] }), true);
    assert.equal(skipSherpaPersonRowHasBillableHit(200, { persons: [] }), false);
    assert.equal(skipSherpaPersonRowHasBillableHit(200, {}), false);
    assert.equal(skipSherpaPersonRowHasBillableHit(200, null), false);
    assert.equal(skipSherpaPersonRowHasBillableHit(500, { persons: [{ name: 'A' }] }), false);
    assert.equal(skipSherpaPersonRowHasBillableHit(199, { persons: [{ name: 'A' }] }), false);
  });
});
