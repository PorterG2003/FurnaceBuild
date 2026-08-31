import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { pickCompanyDomain, splitProspectCompanies } from './prepFromProspects.js';

describe('pickCompanyDomain', () => {
  it('skips GreenCE / BNP / ARCAT and keeps the manufacturer host', () => {
    const picked = pickCompanyDomain(
      {
        company_name: 'Kalwall',
        example_urls: 'https://www.greence.com/sponsors/kalwall | https://kalwall.com/ce',
        registration_host_domain: 'greence.com',
      },
      [
        {
          provider_name: 'Kalwall',
          homepage_url: 'https://www.kalwall.com/',
          listed_website: 'https://www.arcat.com/ces/kalwall',
        },
      ],
    );
    assert.equal(picked?.domain, 'kalwall.com');
  });

  it('returns null when every URL is a CE platform or directory', () => {
    const picked = pickCompanyDomain(
      {
        company_name: 'No Site Corp',
        example_urls: 'https://continuingeducation.bnpmedia.com/sponsors/no-site',
      },
      [{ provider_name: 'No Site Corp', listed_website: 'https://www.greence.com/s/no-site' }],
    );
    assert.equal(picked, null);
  });
});

describe('splitProspectCompanies', () => {
  it('only uses fit_tier 1 and 2 and dedupes domains', () => {
    const { withDomain, platformOnly } = splitProspectCompanies(
      [
        { company_name: 'Acme', fit_tier: '1', example_urls: 'https://acme.com' },
        { company_name: 'Acme Dup', fit_tier: '2', example_urls: 'https://www.acme.com/ce' },
        { company_name: 'School', fit_tier: '0', example_urls: 'https://school.edu' },
        { company_name: 'Platform Co', fit_tier: '2', example_urls: 'https://www.aecdaily.com/s/x' },
      ],
      [],
    );
    assert.equal(withDomain.length, 1);
    assert.equal(withDomain[0]?.company_domain, 'acme.com');
    assert.equal(platformOnly.length, 1);
    assert.equal(platformOnly[0]?.company_name, 'Platform Co');
  });
});
