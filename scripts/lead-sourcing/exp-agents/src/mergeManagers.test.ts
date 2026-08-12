import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { evaluateQualityGate, mergeAndClassify } from './mergeManagers.ts';
import type { MasterAgent } from './rosterMatch.ts';
import type { CapturedRoster, RosterHostManifest } from './rosterTypes.ts';

function master(partial: Partial<MasterAgent> & { id: string }): MasterAgent {
  return {
    first_name: 'Test',
    last_name: 'Agent',
    email: `${partial.id}@example.com`,
    phone: '',
    city: 'Chicago',
    state: 'IL',
    country: 'US',
    bio: '',
    ...partial,
  };
}

describe('manager merge and quality gate', () => {
  it('classifies and covers matched managers by jurisdiction', () => {
    const masters = [
      master({
        id: '1',
        first_name: 'Steve',
        last_name: 'Rettig',
        email: 'steve@example.com',
        bio: 'Designated Managing Broker supporting 1000 agents',
      }),
      master({
        id: '2',
        first_name: 'Pam',
        last_name: 'Raver',
        email: 'pam@example.com',
        bio: 'Broker helping buyers and sellers',
      }),
      master({ id: '3', first_name: 'Unseen', last_name: 'Agent', email: 'u@example.com' }),
    ];
    const captures: CapturedRoster[] = [
      {
        host: 'https://il.exprealty.com',
        capturedAt: new Date().toISOString(),
        count: 2,
        agents: [
          {
            agentid: 10,
            fname: 'Steve',
            lname: 'Rettig',
            email: 'steve@example.com',
            title: 'Designated Managing Broker, Illinois',
            position_types: ['Designated Managing Broker'],
            description: 'I manage and support 1400 agents in Illinois.',
          },
          {
            agentid: 11,
            fname: 'Pam',
            lname: 'Raver',
            email: 'pam@example.com',
            title: 'Broker',
            position_types: [],
            description: 'Full service realtor.',
          },
        ],
      },
    ];
    const manifest: RosterHostManifest = {
      generatedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      hosts: [
        {
          host: 'https://il.exprealty.com',
          prefix: 'il',
          jurisdictions: ['IL'],
          kind: 'regional',
          status: 'healthy',
          rosterCount: 2,
          agentsPhpOk: true,
          lastProbedAt: null,
          lastCapturedAt: null,
          error: null,
          source: 'seed',
        },
      ],
    };

    const merge = mergeAndClassify({
      master: masters,
      captures,
      jurisdictions: ['IL'],
      manifest,
    });

    assert.equal(merge.highConfidence.length, 1);
    assert.equal(merge.highConfidence[0].master_id, '1');
    assert.equal(merge.coverageByJurisdiction.IL.matchedMasterIds, 2);
    assert.equal(merge.coverageByJurisdiction.IL.coveragePct, 66.7);
  });

  it('requires both coverage and precision gates', () => {
    const coverageByJurisdiction = {
      IL: {
        masterRows: 100,
        matchedMasterIds: 80,
        coveragePct: 80,
        high: 5,
        medium: 2,
        hosts: ['https://il.exprealty.com'],
      },
      TX: {
        masterRows: 100,
        matchedMasterIds: 50,
        coveragePct: 50,
        high: 3,
        medium: 1,
        hosts: ['https://ntx.exprealty.com'],
      },
    };
    const failed = evaluateQualityGate({
      coverageByJurisdiction,
      precisionPct: 92,
    });
    assert.equal(failed.coveragePassed, false);
    assert.equal(failed.precisionPassed, true);
    assert.equal(failed.passed, false);
    assert.deepEqual(failed.failingJurisdictions, ['TX']);

    const passed = evaluateQualityGate({
      coverageByJurisdiction: {
        IL: coverageByJurisdiction.IL,
      },
      precisionPct: 95,
    });
    assert.equal(passed.passed, true);
  });
});
