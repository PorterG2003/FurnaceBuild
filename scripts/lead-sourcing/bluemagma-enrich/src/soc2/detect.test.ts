import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixturesDir } from '../lib/env.js';
import { detectSoc2FromSerper, detectSoc2OnPage } from './detect.js';

function load(rel: string): string {
  return readFileSync(join(fixturesDir, rel), 'utf8');
}

describe('SOC2 detectors', () => {
  it('treats first-person attestation on a homepage as yes', () => {
    const html = '<p>We are SOC 2 Type II certified. Download our SOC 2 report.</p>';
    const hit = detectSoc2OnPage({ html, url: 'https://example.com', method: 'homepage' });
    assert.equal(hit?.has_soc2, 'yes');
    assert.equal(hit?.soc2_method, 'homepage');
  });

  it('does not treat product copy about getting SOC 2 as company attestation', () => {
    const html = load('homepages/dash-complyops.html');
    const hit = detectSoc2OnPage({
      html,
      url: 'https://dashcomplyops.com',
      method: 'homepage',
    });
    assert.equal(hit, null);
  });

  it('accepts SOC 2 on a trust-center page', () => {
    const html = load('pages/shiphero-trust.html');
    const hit = detectSoc2OnPage({
      html,
      url: 'https://shiphero.com/trust',
      method: 'trust_page',
    });
    assert.equal(hit?.has_soc2, 'yes');
    assert.equal(hit?.soc2_method, 'trust_page');
    assert.match(hit?.soc2_evidence_snippet ?? '', /SOC 2/i);
  });

  it('accepts Serper evidence with a SOC 2 report snippet', () => {
    const hit = detectSoc2FromSerper({
      domain: 'shiphero.com',
      results: [
        {
          title: 'ShipHero Trust Center — SOC 2 Type II',
          link: 'https://shiphero.com/trust',
          snippet: 'Download our SOC 2 Type II report.',
        },
      ],
    });
    assert.equal(hit?.has_soc2, 'yes');
    assert.equal(hit?.soc2_method, 'serper');
    assert.equal(hit?.soc2_evidence_url, 'https://shiphero.com/trust');
  });

  it('ignores Serper product copy about automating SOC 2', () => {
    const hit = detectSoc2FromSerper({
      domain: 'dashcomplyops.com',
      results: [
        {
          title: 'Get SOC 2 in weeks',
          link: 'https://dashcomplyops.com',
          snippet: 'SOC 2 automation for healthcare teams.',
        },
      ],
    });
    assert.equal(hit, null);
  });

  it('ignores blog posts and consulting/readiness pages in Serper', () => {
    assert.equal(
      detectSoc2FromSerper({
        domain: 'grclab.com',
        results: [
          {
            title: 'The Future of SOC 2',
            link: 'https://blog.grclab.com/p/c52026',
            snippet: 'SOC 2 is principles-based; the provider defines their own controls.',
          },
        ],
      }),
      null,
    );
    assert.equal(
      detectSoc2FromSerper({
        domain: 'optimoit.io',
        results: [
          {
            title: 'SOC 2 Audit Readiness Services',
            link: 'https://www.optimoit.io/soc-2-audit-readiness-services',
            snippet: 'Prepare for SOC 2 audit with our team.',
          },
        ],
      }),
      null,
    );
  });

  it('ignores framework lists and client-SOC2 consulting copy on-page', () => {
    const frameworks = detectSoc2OnPage({
      html: '<p>Solutions Frameworks CMMC FedRAMP SOC 2 GDPR ISO 27001 Trust center</p>',
      url: 'https://mycroft.io/security',
      method: 'trust_page',
    });
    assert.equal(frameworks, null);

    const consulting = detectSoc2OnPage({
      html: '<p>Our Trust Advantage clients enjoy a full service Audit Concierge during SOC 2 Type 1 and SOC 2 Type 2 evidence request periods.</p>',
      url: 'https://managedrisk.ca',
      method: 'homepage',
    });
    assert.equal(consulting, null);
  });
});
