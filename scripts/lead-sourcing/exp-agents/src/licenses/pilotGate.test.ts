import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { BrokerLeadRow, LicenseMatchResult, LicenseRecord } from '../brokerExpansionTypes.ts';
import { buildLicensePilotGate } from './pilotGate.ts';

function license(partial: Partial<LicenseRecord>): LicenseRecord {
  return {
    source: 'tx_trec',
    licenseNumber: '1',
    licenseType: 'Broker',
    status: 'Active',
    firstName: 'A',
    lastName: 'B',
    fullName: 'A B',
    email: '',
    phone: '',
    city: 'Austin',
    county: '',
    state: 'TX',
    expiration: '',
    designatedSupervisor: false,
    sponsoringBroker: '',
    agencyName: '',
    raw: {},
    ...partial,
  };
}

function lead(partial: Partial<BrokerLeadRow>): BrokerLeadRow {
  return {
    master_id: '1',
    first_name: 'A',
    last_name: 'B',
    email: '',
    phone: '',
    city: '',
    state: 'TX',
    country: 'US',
    audience_tier: 'C',
    role_category: 'broker',
    campaign_segment: 'broker',
    score: '1',
    categories: 'license_broker',
    evidence: 'license',
    signal_sources: 'license:tx_trec',
    source_hosts: '',
    roster_agent_ids: '',
    roster_titles: '',
    roster_position_types: '',
    match_methods: 'name_state_unique',
    profile_urls: '',
    license_numbers: '1',
    license_types: 'Broker',
    license_states: 'TX',
    license_status: 'Active',
    designated_supervisor: '',
    sponsoring_broker: '',
    ...partial,
  };
}

describe('license pilot gate', () => {
  it('holds additional states when name matches dominate', () => {
    const matches: LicenseMatchResult[] = [
      {
        masterId: '1',
        license: license({ licenseNumber: '1' }),
        matchMethod: 'name_state_unique',
        ambiguous: false,
      },
      {
        masterId: '2',
        license: license({
          licenseNumber: '2',
          firstName: 'C',
          lastName: 'D',
          fullName: 'C D',
          email: 'c@example.com',
          city: 'Dallas',
        }),
        matchMethod: 'email',
        ambiguous: false,
      },
    ];
    const gate = buildLicensePilotGate({
      rows: [
        lead({ master_id: '1', match_methods: 'name_state_unique' }),
        lead({
          master_id: '2',
          match_methods: 'email',
          audience_tier: 'A',
          campaign_segment: 'manager',
        }),
      ],
      matches,
      ambiguous: [],
    });
    assert.equal(gate.decision, 'HOLD_ADDITIONAL_STATES');
    assert.equal(gate.strongMethodMatches, 1);
    assert.equal(gate.nameStateMatchesNeedingReview, 1);
  });
});
