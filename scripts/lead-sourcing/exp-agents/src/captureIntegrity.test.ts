import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assessCaptureIntegrity,
  findDuplicateTinyCaptures,
} from './captureIntegrity.ts';
import type { CapturedRoster } from './rosterTypes.ts';

function capture(host: string, agentid: number): CapturedRoster {
  return {
    host,
    capturedAt: new Date().toISOString(),
    count: 1,
    agents: [
      {
        agentid,
        fname: 'A',
        lname: 'B',
        email: 'a@example.com',
        title: '',
        position_types: [],
        description: '',
      },
    ],
  };
}

describe('capture integrity', () => {
  it('flags tiny non-state hosts as untrusted', () => {
    const result = assessCaptureIntegrity(capture('https://abor.exprealty.com', 1));
    assert.equal(result.kind, 'suspicious_tiny');
    assert.equal(result.trustedForCoverage, false);
  });

  it('detects the same agent returned by multiple tiny hosts', () => {
    const dupes = findDuplicateTinyCaptures([
      capture('https://abor.exprealty.com', 1060728),
      capture('https://ntreis.exprealty.com', 1060728),
      capture('https://sandiego.exprealty.com', 1053664),
    ]);
    assert.equal(dupes.length, 1);
    assert.equal(dupes[0].agentId, '1060728');
    assert.deepEqual(dupes[0].hosts, [
      'https://abor.exprealty.com',
      'https://ntreis.exprealty.com',
    ]);
  });
});
