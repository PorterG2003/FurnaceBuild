import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { MasterAgent } from '../rosterMatch.ts';
import { matchLicensesToMaster } from './matchToMaster.ts';
import { normalizeTxTrecRow } from './normalize.ts';

describe('license matching', () => {
  it('matches unique name+state and rejects common-name collisions without tie-breakers', () => {
    const master: MasterAgent[] = [
      {
        id: '1',
        first_name: 'Casey',
        last_name: 'Supervisor',
        email: 'casey@example.com',
        phone: '5125550100',
        city: 'Austin',
        state: 'TX',
        country: 'US',
        bio: '',
      },
      {
        id: '2',
        first_name: 'John',
        last_name: 'Smith',
        email: 'john1@example.com',
        phone: '',
        city: 'Dallas',
        state: 'TX',
        country: 'US',
        bio: '',
      },
      {
        id: '3',
        first_name: 'John',
        last_name: 'Smith',
        email: 'john2@example.com',
        phone: '',
        city: 'Houston',
        state: 'TX',
        country: 'US',
        bio: '',
      },
    ];
    const licenses = [
      normalizeTxTrecRow({
        'License Type': 'Broker',
        'License Number': '654321',
        'Full Name': 'Casey Supervisor',
        'Designated Supervisor Flag': 'Y',
        City: 'Austin',
      })!,
      normalizeTxTrecRow({
        'License Type': 'Broker',
        'License Number': '999000',
        'Full Name': 'John Smith',
        'Designated Supervisor Flag': 'N',
      })!,
    ];
    const result = matchLicensesToMaster(master, licenses);
    assert.equal(result.matches.length, 1);
    assert.equal(result.matches[0].masterId, '1');
    assert.ok(result.ambiguous.length >= 1 || result.unmatchedLicenses >= 1);
  });

  it('prefers license numbers extracted from bios', () => {
    const master: MasterAgent[] = [
      {
        id: '9',
        first_name: 'Mike',
        last_name: 'Sample',
        email: 'mike@example.com',
        phone: '',
        city: 'Bakersfield',
        state: 'CA',
        country: 'US',
        bio: 'CA DRE# 01454605 serving Kern County.',
      },
    ];
    const licenses = [
      {
        source: 'ca_dre' as const,
        licenseNumber: '01454605',
        licenseType: 'Broker',
        status: 'Valid',
        fullName: 'Someone Else',
        firstName: 'Someone',
        lastName: 'Else',
        state: 'CA',
        city: '',
        county: '',
        email: '',
        phone: '',
        expiration: '',
        designatedSupervisor: false,
        sponsoringBroker: '',
        agencyName: '',
        raw: {},
      },
    ];
    const result = matchLicensesToMaster(master, licenses);
    assert.equal(result.matches.length, 1);
    assert.equal(result.matches[0].matchMethod, 'license_number');
    assert.equal(result.matches[0].masterId, '9');
  });
});
