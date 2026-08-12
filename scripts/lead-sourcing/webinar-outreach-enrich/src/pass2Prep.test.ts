import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { companyKey, estimatePass2, prepPass2 } from './pass2Prep.js';

describe('pass2Prep', () => {
  it('companyKey prefers ad_id', () => {
    assert.equal(companyKey({ ad_id: '123', company_name: 'A' }), 'ad:123');
  });

  it('estimates include recommended caps', () => {
    const est = estimatePass2({
      named: 10,
      linkedinToApollo: 20,
      metaGatedProspeo: 30,
      nameOnly: 40,
    });
    assert.equal(est.hard_caps_recommended.max_prospeo_credits, 200);
    assert.equal(est.stage_2a_named_prospeo.rows, 10);
  });

  it('prepPass2 writes manifests and skips have-email', () => {
    const root = mkdtempSync(join(tmpdir(), 'pass2-prep-'));
    const pass1 = join(root, 'pass1');
    const pass2 = join(root, 'pass2');
    mkdirSync(pass1, { recursive: true });

    writeFileSync(
      join(pass1, 'enriched_leads.csv'),
      'platform,provider,company_name,company_domain,contact_email,ad_id\nlinkedin,prospeo,Hit Co,hit.com,a@hit.com,ad1\n',
    );
    writeFileSync(
      join(pass1, 'linkedin_cohort.csv'),
      'platform,company_name,company_url,company_domain,landing_url,landing_domain,person_name,ad_library_url,ad_id,has_usable_domain,has_person_name,has_company_linkedin,phrases_found,source_runs\n' +
        'linkedin,Hit Co,,hit.com,,,Jane,https://li/1,ad1,true,true,false,,\n' +
        'linkedin,Miss Named,,,https://x.com,,Bob,https://li/2,ad2,false,true,false,,\n' +
        'linkedin,Miss Domain,,miss.com,,,,https://li/3,ad3,true,false,false,,\n',
    );
    writeFileSync(
      join(pass1, 'linkedin_enriched.csv'),
      'company_name,company_domain,company_url,ad_library_url,ad_id,person_name_source,contact_email,match_path,status\n' +
        'Hit Co,hit.com,,https://li/1,ad1,Jane,a@hit.com,named_enrich,matched\n' +
        'Miss Named,,,https://li/2,ad2,Bob,,named_enrich,no_match\n' +
        'Miss Domain,miss.com,,https://li/3,ad3,,,company_path,no_match\n',
    );
    writeFileSync(
      join(pass1, 'meta_cohort.csv'),
      'platform,company_name,company_url,company_domain,landing_url,landing_domain,person_name,ad_library_url,ad_id,has_usable_domain,has_person_name,has_company_linkedin,phrases_found,source_runs\n' +
        'meta,Meta Named,,,https://zoom.us,,Pat,https://fb/1,m1,false,true,false,,\n' +
        'meta,Meta Domain,,meta.co,,,,https://fb/2,m2,true,false,false,,\n',
    );
    writeFileSync(
      join(pass1, 'meta_domain_gated.csv'),
      'platform,company_name,company_url,company_domain,landing_url,landing_domain,person_name,ad_library_url,ad_id,has_usable_domain,has_person_name,has_company_linkedin,phrases_found,source_runs\n' +
        'meta,Meta Domain,,meta.co,,,,https://fb/2,m2,true,false,false,,\n',
    );
    writeFileSync(
      join(pass1, 'meta_enriched.csv'),
      'platform,company_name,company_domain,contact_email,ad_library_url\n',
    );

    const result = prepPass2({ pass1Dir: pass1, pass2Dir: pass2 });
    assert.equal(result.counts.named, 2); // Miss Named + Meta Named
    assert.ok(result.counts.linkedin_to_apollo >= 1);
    assert.equal(result.counts.meta_gated_to_prospeo, 1);
    assert.equal(result.counts.name_only, 1); // Meta Named no domain also in name_only; Miss Named linkedin without domain
    // Miss Named is linkedin name-only AND named — named list + name_only
    assert.ok(result.counts.name_only >= 1);
  });
});
