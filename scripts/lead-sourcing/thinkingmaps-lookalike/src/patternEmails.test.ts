import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fillPatternEmails, inferEmailPattern, learnDistrictPatterns } from './patternEmails.js';
import type { ListedSchool, RawSchoolContact } from './types.js';

function contact(partial: Partial<RawSchoolContact>): RawSchoolContact {
  return {
    ncessch: '1',
    leaid: '4702220',
    school_name: 'West High',
    first_name: 'Jane',
    last_name: 'Doe',
    title: 'Principal',
    email: 'jane.doe@knoxschools.org',
    linkedin_url: '',
    company: 'West High',
    phone: '',
    provider: 'directory',
    email_risk: '',
    person_id: '1',
    ...partial,
  };
}

describe('patternEmails', () => {
  it('infers first.last and flast from known emails', () => {
    assert.equal(inferEmailPattern('jane.doe', 'Jane', 'Doe'), 'first.last');
    assert.equal(inferEmailPattern('jdoe', 'Jane', 'Doe'), 'flast');
    assert.equal(inferEmailPattern('janedoe', 'Jane', 'Doe'), 'firstlast');
  });

  it('learns the majority pattern and domain per district', () => {
    const learned = learnDistrictPatterns([
      contact({}),
      contact({ first_name: 'Sam', last_name: 'Lee', email: 'sam.lee@knoxschools.org' }),
      contact({ leaid: '0629580', email: 'jsmith@palmdalesd.org', first_name: 'John', last_name: 'Smith' }),
    ]);
    assert.equal(learned.get('4702220')?.domain, 'knoxschools.org');
    assert.equal(learned.get('4702220')?.pattern, 'first.last');
    assert.equal(learned.get('0629580')?.pattern, 'flast');
  });

  it('verifies people concurrently and resumes from next_index', async () => {
    const runDir = mkdtempSync(join(tmpdir(), 'pattern-emails-'));
    const school: ListedSchool = {
      ncessch: '470222000001',
      leaid: '4702220',
      school_name: 'West High',
      state: 'TN',
      city: 'Knoxville',
      zip: '37901',
      lea_name: 'Knox',
      excluded: false,
      exclude_reason: '',
      won_account_id: '',
      won_account_name: '',
      match_confidence: 'high',
      match_score: '1',
    };
    writeFileSync(
      join(runDir, 'district_sites.csv'),
      'leaid,lea_name,state,website,host,confidence,score,evidence,source,email_domain,needs_review,review_reason\n4702220,Knox,TN,,,high,1,,,knoxschools.org,false,\n',
      'utf8',
    );
    const people = Array.from({ length: 8 }, (_, i) => ({
      first: `Pat${i}`,
      last: `Lee${i}`,
    }));
    writeFileSync(
      join(runDir, 'state_directory_people.csv'),
      [
        'leaid,ncessch,school_name,first_name,last_name,title',
        ...people.map((row) => `4702220,${school.ncessch},West High,${row.first},${row.last},Principal`),
      ].join('\n'),
      'utf8',
    );
    writeFileSync(
      join(runDir, 'pattern_emails_checkpoint.json'),
      `${JSON.stringify({
        version: 1,
        status: 'in_progress',
        next_index: 3,
        mv_calls: 3,
        results: people.slice(0, 3).map((row) => ({
          ncessch: school.ncessch,
          leaid: school.leaid,
          school_name: school.school_name,
          first_name: row.first,
          last_name: row.last,
          title: 'Principal',
          email: `${row.first.toLowerCase()}.${row.last.toLowerCase()}@knoxschools.org`,
          linkedin_url: '',
          company: school.school_name,
          phone: '',
          provider: 'state_agency',
          email_risk: '',
          person_id: 'prior',
        })),
        district_pattern: { '4702220': 'first.last' },
      })}\n`,
      'utf8',
    );

    let inflight = 0;
    let maxInflight = 0;
    try {
      const patterned = await fillPatternEmails({
        runDir,
        schools: [school],
        live: true,
        dryRun: false,
        fixtures: false,
        concurrency: 4,
        verifyImpl: async (email) => {
          inflight += 1;
          maxInflight = Math.max(maxInflight, inflight);
          await new Promise((resolve) => setTimeout(resolve, 40));
          inflight -= 1;
          return { email, result: 'ok' };
        },
      });
      assert.ok(maxInflight > 1, `expected overlapping verifies, got maxInflight=${maxInflight}`);
      assert.equal(patterned.contacts.length, 8);
      assert.equal(patterned.mv_calls, 8);
    } finally {
      rmSync(runDir, { recursive: true, force: true });
    }
  });
});
