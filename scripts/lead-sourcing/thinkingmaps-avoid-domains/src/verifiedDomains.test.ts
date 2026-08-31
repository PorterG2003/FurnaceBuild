import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MANUAL_VERIFICATIONS } from './verifiedDomains.js';

describe('manual email-domain verifications', () => {
  it('has unique lookup names and matching sample-email domains', () => {
    const names = MANUAL_VERIFICATIONS.map((entry) => entry.lookupName.toLowerCase());
    assert.equal(new Set(names).size, names.length);

    for (const entry of MANUAL_VERIFICATIONS) {
      if (entry.status !== 'verified') {
        assert.equal(entry.domains.length, 0, entry.lookupName);
        assert.ok(entry.note, entry.lookupName);
        continue;
      }
      assert.ok(entry.domains.length > 0, entry.lookupName);
      for (const evidence of entry.domains) {
        assert.equal(
          evidence.sampleEmail.toLowerCase().split('@')[1],
          evidence.domain,
          `${entry.lookupName}: ${evidence.sampleEmail}`,
        );
        assert.match(evidence.evidenceUrl, /^https:\/\//, entry.lookupName);
      }
    }
  });

  it('keeps known website domains out of corrected email-domain mappings', () => {
    const byName = new Map(
      MANUAL_VERIFICATIONS.map((entry) => [
        entry.lookupName,
        new Set(entry.domains.map((evidence) => evidence.domain)),
      ]),
    );

    assert.deepEqual([...byName.get('Alpine District')!], ['alpinedistrict.org']);
    assert.deepEqual([...byName.get('Anaheim Elementary SD')!], ['aesd.org']);
    assert.deepEqual([...byName.get('Santa Maria-Bonita School District')!], ['smbsd.net']);
    assert.deepEqual([...byName.get('LaunchED Academy')!], ['svvsd.org']);
    assert.deepEqual([...byName.get('San Bernardino City Unified School District')!], [
      'sbcusd.k12.ca.us',
    ]);
    assert.deepEqual([...byName.get('Fort Bend ISD')!], ['fortbendisd.gov']);
    assert.deepEqual([...byName.get('Loudoun County Public Schools VA')!], ['lcps.org']);
  });
});
