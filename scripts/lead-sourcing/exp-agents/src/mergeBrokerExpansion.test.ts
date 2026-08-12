import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildBrokerLeadRows,
  mergeBioCandidates,
  mergeLicenseMatches,
  mergeRosterCaptures,
} from './mergeBrokerExpansion.ts';
import type { LicenseMatchResult } from './brokerExpansionTypes.ts';
import type { MasterAgent } from './rosterMatch.ts';
import type { CapturedRoster, RosterHostManifest } from './rosterTypes.ts';

function master(partial: Partial<MasterAgent> & { id: string }): MasterAgent {
  return {
    first_name: 'Test',
    last_name: 'Agent',
    email: `${partial.id}@example.com`,
    phone: '',
    city: 'Austin',
    state: 'TX',
    country: 'US',
    bio: '',
    ...partial,
  };
}

describe('broker expansion merge', () => {
  it('aggregates cross-host evidence and keeps tier precedence A>B>C>D', () => {
    const masters = [
      master({
        id: '1',
        first_name: 'Alex',
        last_name: 'Leader',
        email: 'alex@example.com',
        bio: 'I am a licensed real estate broker.',
      }),
      master({
        id: '2',
        first_name: 'Blake',
        last_name: 'Broker',
        email: 'blake@example.com',
      }),
    ];
    const captures: CapturedRoster[] = [
      {
        host: 'https://ntx.exprealty.com',
        capturedAt: new Date().toISOString(),
        count: 2,
        agents: [
          {
            agentid: 1,
            fname: 'Alex',
            lname: 'Leader',
            email: 'alex@example.com',
            title: 'Broker',
            position_types: [],
            description: '',
          },
          {
            agentid: 2,
            fname: 'Blake',
            lname: 'Broker',
            email: 'blake@example.com',
            title: 'Broker Associate',
            position_types: ['Broker'],
            description: '',
          },
        ],
      },
      {
        host: 'https://har.exprealty.com',
        capturedAt: new Date().toISOString(),
        count: 1,
        agents: [
          {
            agentid: 1,
            fname: 'Alex',
            lname: 'Leader',
            email: 'alex@example.com',
            title: 'Team Leader',
            position_types: ['Team Leader'],
            description: '',
          },
        ],
      },
    ];
    const manifest: RosterHostManifest = {
      generatedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      hosts: [
        {
          host: 'https://ntx.exprealty.com',
          prefix: 'ntx',
          jurisdictions: ['TX'],
          kind: 'regional',
          status: 'healthy',
          rosterCount: 2,
          agentsPhpOk: true,
          lastProbedAt: null,
          lastCapturedAt: null,
          error: null,
          source: 'seed',
        },
        {
          host: 'https://har.exprealty.com',
          prefix: 'har',
          jurisdictions: ['TX'],
          kind: 'regional',
          status: 'healthy',
          rosterCount: 1,
          agentsPhpOk: true,
          lastProbedAt: null,
          lastCapturedAt: null,
          error: null,
          source: 'seed',
        },
      ],
    };

    const merged = mergeRosterCaptures({ master: masters, captures, manifest });
    mergeBioCandidates(merged.byMaster, masters);
    const rows = buildBrokerLeadRows(merged.byMaster);
    assert.equal(rows.length, 2);
    const alex = rows.find((row) => row.master_id === '1')!;
    assert.equal(alex.audience_tier, 'A');
    assert.ok(alex.source_hosts.includes('https://har.exprealty.com'));
    assert.ok(alex.source_hosts.includes('https://ntx.exprealty.com'));
    assert.ok(alex.signal_sources.includes('bio') || alex.signal_sources.includes('roster'));
    const blake = rows.find((row) => row.master_id === '2')!;
    assert.equal(blake.audience_tier, 'C');
  });

  it('applies license supervisor flags as manager evidence', () => {
    const masters = [
      master({
        id: '9',
        first_name: 'Casey',
        last_name: 'Supervisor',
        email: 'casey@example.com',
        state: 'TX',
      }),
    ];
    const merged = mergeRosterCaptures({
      master: masters,
      captures: [],
      manifest: null,
    });
    const matches: LicenseMatchResult[] = [
      {
        masterId: '9',
        matchMethod: 'name_state_unique',
        ambiguous: false,
        license: {
          source: 'tx_trec',
          licenseNumber: '123456',
          licenseType: 'Broker',
          status: 'Active',
          fullName: 'Casey Supervisor',
          firstName: 'Casey',
          lastName: 'Supervisor',
          state: 'TX',
          city: 'Austin',
          county: '',
          email: '',
          phone: '',
          expiration: '',
          designatedSupervisor: true,
          sponsoringBroker: '',
          agencyName: '',
          raw: {},
        },
      },
    ];
    mergeLicenseMatches(merged.byMaster, new Map(masters.map((row) => [row.id, row])), matches);
    const rows = buildBrokerLeadRows(merged.byMaster);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].audience_tier, 'A');
    assert.equal(rows[0].designated_supervisor, 'true');
  });
});
