import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixturesDir } from '../lib/env.js';
import { parseDirectoryHtml, nasbaPagePlan, acpePagePlan } from './parse.js';

function ctx(id: string, url: string, profession: string) {
  return {
    source_directory: id,
    accreditor: id,
    audience_profession: profession,
    source_url: url,
  };
}

describe('directory parsers', () => {
  it('parses NASBA headings into sponsor names and websites', () => {
    const html = readFileSync(join(fixturesDir, 'directories/nasba.html'), 'utf8');
    const rows = parseDirectoryHtml('nasba', html, ctx('nasba', 'https://www.nasbaregistry.org/sponsor-list', 'cpa'));
    const names = rows.map((r) => r.provider_name);
    assert.ok(names.includes('LedgerSoft Inc.'));
    assert.ok(names.includes('CPE Learning Institute'));
    assert.equal(rows.find((r) => r.provider_name === 'LedgerSoft Inc.')?.listed_website, 'https://ledgersoft.example/');
  });

  it('parses NASBA JSON-LD organization urls', () => {
    const html = `<script type="application/ld+json">{"@context":"https://schema.org","@type":"ProfilePage","mainEntity":{"@type":"Organization","url":"http://www.freshbooks.com","name":"2nd Site Inc DBA FreshBooks"}}</script>`;
    const rows = parseDirectoryHtml('nasba', html, ctx('nasba', 'https://www.nasbaregistry.org/sponsor-list', 'cpa'));
    assert.equal(rows[0]?.provider_name, '2nd Site Inc DBA FreshBooks');
    assert.equal(rows[0]?.listed_website, 'http://freshbooks.com/');
  });

  it('parses ASWB JSON API rows and websites without a scheme', () => {
    const raw = JSON.stringify([
      { 'provider name': 'PESI, Inc.', 'provider websites': 'www.pesi.com', status: 'Approved Provider Approval' },
      { 'provider name': 'Casey Family Program', 'provider websites': 'www.casey.org', status: 'Joint Accredited Provider' },
    ]);
    const rows = parseDirectoryHtml('aswb', raw, ctx('aswb', 'https://aswb.example/api', 'social_worker'));
    assert.equal(rows.length, 2);
    assert.equal(rows[0]?.listed_website, 'https://pesi.com/');
  });

  it('drops ASWB individual-course approvals from the provider list', () => {
    const raw = JSON.stringify([
      { 'provider name': 'PESI, Inc.', 'provider websites': 'www.pesi.com', status: 'Approved Provider Approval' },
      { 'provider name': 'Jane Doe LCSW', 'provider websites': 'www.janedoe.example', status: 'Approved Individual Course Approval' },
    ]);
    const rows = parseDirectoryHtml('aswb', raw, ctx('aswb', 'https://aswb.example/api', 'social_worker'));
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.provider_name, 'PESI, Inc.');
  });

  it('parses NBCC, ASWB, and ARCAT fixtures', () => {
    const nbcc = parseDirectoryHtml(
      'nbcc',
      readFileSync(join(fixturesDir, 'directories/nbcc.html'), 'utf8'),
      ctx('nbcc', 'https://search.nbcc.org/Search/ACEP', 'counselor'),
    );
    const aswb = parseDirectoryHtml(
      'aswb',
      readFileSync(join(fixturesDir, 'directories/aswb.html'), 'utf8'),
      ctx('aswb', 'https://www.aswb.org/ace', 'social_worker'),
    );
    const arcat = parseDirectoryHtml(
      'arcat',
      readFileSync(join(fixturesDir, 'directories/arcat.html'), 'utf8'),
      ctx('arcat', 'https://www.arcat.com/ces', 'architect'),
    );
    assert.ok(nbcc.some((r) => r.provider_name === 'TherapyMatch Inc.'));
    assert.ok(aswb.some((r) => r.provider_name === 'CareBridge EHR'));
    assert.ok(arcat.some((r) => r.provider_name.startsWith('Acme Windows')));
  });

  it('parses NBCC Blazor table rows and keeps Iris-shaped names', () => {
    const rows = parseDirectoryHtml(
      'nbcc',
      readFileSync(join(fixturesDir, 'directories/nbcc-blazor.html'), 'utf8'),
      ctx('nbcc', 'https://www.nbcc.org/search/acepdirectory', 'counselor'),
    );
    const names = rows.map((r) => r.provider_name);
    assert.ok(names.includes('Iris Training Collective'));
    assert.ok(names.includes('PESI, Inc.'));
    assert.ok(!names.some((n) => /home study/i.test(n)));
    assert.ok(!names.some((n) => /former acep/i.test(n)));
    assert.match(
      rows.find((r) => r.provider_name === 'Iris Training Collective')?.listed_website ?? '',
      /iristrainingcollective\.com/,
    );
  });

  it('parses NBCC JSON dump rows and skips Home Study-only and former ACEPs', () => {
    const rows = parseDirectoryHtml(
      'nbcc',
      readFileSync(join(fixturesDir, 'directories/nbcc.json'), 'utf8'),
      ctx('nbcc', 'https://www.nbcc.org/search/acepdirectory', 'counselor'),
    );
    const names = rows.map((r) => r.provider_name);
    assert.deepEqual(names, ['Iris Training Collective', 'PESI, Inc.']);
    assert.match(rows[0]?.listed_website ?? '', /iristrainingcollective\.com/);
  });

  it('parses NBCC ACEP API providerName payloads and drops home-study-only', () => {
    const raw = JSON.stringify({
      message: 'Successfully gotten ACEP providers by state!',
      success: true,
      data: [
        {
          providerName: 'Iris Training Collective',
          website: 'https://iristrainingcollective.com',
          isHomeStudy: false,
          liveTrainingProvider: true,
          active: true,
        },
        {
          providerName: 'Quiet Counsel Home Study LLC',
          website: 'https://quietcounsel.example',
          isHomeStudy: true,
          liveTrainingProvider: false,
          active: true,
        },
        {
          providerName: 'Former ACEP Counseling Group',
          website: 'https://former.example',
          isHomeStudy: false,
          liveTrainingProvider: true,
          active: false,
        },
      ],
    });
    const rows = parseDirectoryHtml(
      'nbcc',
      raw,
      ctx('nbcc', 'https://www.nbcc.org/search/acepdirectory', 'counselor'),
    );
    assert.deepEqual(
      rows.map((r) => r.provider_name),
      ['Iris Training Collective'],
    );
  });

  it('parses ARCAT ces-x manufacturer rows and loc= CE urls', () => {
    const html = `
      <div class="ces-x">
        <a href="/company/3m-commercial-solutions-47922">3M Commercial Solutions</a>
        <b>[ CES <a href="/ct?coid=47922&amp;pageid=CES&amp;src=ces&amp;loc=https%3A%2F%2Fwww.aecdaily.com%2Fs%2F3m">web page</a> ]</b>
      </div>
      <div class="ces-x">
        <a href="/company/james-hardie-123">James Hardie Building Products, Inc.</a>
        <b>[ CES <a href="/ct?loc=https%3A%2F%2Fwww.jameshardie.com%2Feducation">web page</a> ]</b>
      </div>`;
    const rows = parseDirectoryHtml('arcat', html, ctx('arcat', 'https://www.arcat.com/ces', 'architect'));
    assert.equal(rows.length, 2);
    assert.equal(rows[0]?.provider_name, '3M Commercial Solutions');
    assert.equal(rows[0]?.listed_website, 'https://aecdaily.com/s/3m');
    assert.equal(rows[1]?.provider_name, 'James Hardie Building Products, Inc.');
  });

  it('parses GreenCE Drupal sponsor tables, including name-only lunch-and-learn rows', () => {
    const html = readFileSync(join(fixturesDir, 'directories/greence.html'), 'utf8');
    const rows = parseDirectoryHtml(
      'greence',
      html,
      ctx('greence', 'https://www.greence.com/Course_Sponsors', 'architect'),
    );
    assert.equal(rows.length, 3);
    assert.equal(rows[0]?.provider_name, 'Big Ass Fan Company');
    assert.equal(rows[0]?.listed_website, 'http://bigassfans.com/');
    assert.equal(rows[1]?.provider_name, 'GreenCE, Inc.');
    assert.equal(rows[1]?.listed_website, 'https://greence.com/');
    assert.equal(rows[2]?.provider_name, 'NanaWall Systems');
    assert.equal(rows[2]?.listed_website, '');
  });

  it('parses Ron Blank Drupal sponsor tables with company websites', () => {
    const html = readFileSync(join(fixturesDir, 'directories/ronblank.html'), 'utf8');
    const rows = parseDirectoryHtml(
      'ronblank',
      html,
      ctx('ronblank', 'https://www.ronblank.com/Online_Courses/Course_Sponsors/A-Z', 'architect'),
    );
    assert.equal(rows.length, 2);
    assert.equal(rows[0]?.provider_name, 'ClarkDietrich');
    assert.equal(rows[0]?.listed_website, 'http://clarkdietrich.com/');
    assert.equal(rows[1]?.provider_name, 'Ron Blank & Associates');
    assert.equal(rows[1]?.listed_website, 'https://ronblank.com/');
  });

  it('parses AEC Daily JSON-LD orgs, live session providers, and named /s/ links', () => {
    const html = readFileSync(join(fixturesDir, 'directories/aecdaily.html'), 'utf8');
    const rows = parseDirectoryHtml(
      'aecdaily',
      html,
      ctx('aecdaily', 'https://www.aecdaily.com/olc.php?tabidx=featured', 'architect'),
    );
    const names = rows.map((r) => r.provider_name);
    assert.ok(names.includes('SOPREMA, Inc.'));
    assert.ok(names.includes('Englert, Inc.'));
    assert.ok(names.includes('Concrete Products Group'));
    assert.equal(rows.find((r) => r.provider_name === 'SOPREMA, Inc.')?.listed_website, 'https://aecdaily.com/s/197568');
  });

  it('parses CE Strong WP partner JSON', () => {
    const raw = readFileSync(join(fixturesDir, 'directories/cestrong.html'), 'utf8');
    const rows = parseDirectoryHtml(
      'cestrong',
      raw,
      ctx('cestrong', 'https://www.cestrong.com/wp-json/wp/v2/partners', 'architect'),
    );
    assert.equal(rows.length, 2);
    assert.equal(rows[0]?.provider_name, 'Unilock');
    assert.match(rows[0]?.listed_website ?? '', /cestrong\.com\/partners\/unilock/);
  });

  it('parses BNP sponsor sitemap slugs and skips AIA chapters', () => {
    const xml = readFileSync(join(fixturesDir, 'directories/bnp.html'), 'utf8');
    const rows = parseDirectoryHtml(
      'bnp',
      xml,
      ctx('bnp', 'https://continuingeducation.bnpmedia.com/sitemaps/sitemap_architect.xml', 'architect'),
    );
    assert.equal(rows.length, 2);
    assert.equal(rows[0]?.provider_name, 'The Bilco Company');
    assert.equal(rows[1]?.provider_name, '3M');
    assert.match(rows[0]?.listed_website ?? '', /sponsors\/the-bilco-company/);
  });

  it('parses APA, AOTA, ACPE, and PACE provider dumps', () => {
    const apa = parseDirectoryHtml(
      'apa',
      readFileSync(join(fixturesDir, 'directories/apa.html'), 'utf8'),
      ctx('apa', 'https://apacesasearch.azurewebsites.net/', 'psychologist'),
    );
    const aota = parseDirectoryHtml(
      'aota',
      readFileSync(join(fixturesDir, 'directories/aota.html'), 'utf8'),
      ctx('aota', 'https://www.aota.org/providers.pdf', 'occupational_therapist'),
    );
    const acpe = parseDirectoryHtml(
      'acpe',
      readFileSync(join(fixturesDir, 'directories/acpe.html'), 'utf8'),
      ctx('acpe', 'https://www.acpe-accredit.org/accredited-providers-by-name/', 'pharmacist'),
    );
    const pace = parseDirectoryHtml(
      'pace',
      readFileSync(join(fixturesDir, 'directories/pace.html'), 'utf8'),
      ctx('pace', 'https://pacex.fclb.org/pages/ProviderRenewalSchedule.php', 'chiropractor'),
    );
    assert.ok(apa.some((r) => r.provider_name === 'Behavioral Tech, LLC'));
    assert.ok(aota.some((r) => r.provider_name === 'AdvantageCEUs.com'));
    assert.equal(aota.find((r) => r.provider_name === 'AdvantageCEUs.com')?.listed_website, 'https://advantageceus.com/');
    assert.ok(acpe.some((r) => r.provider_name === 'AchieveCE'));
    assert.ok(pace.some((r) => r.provider_name === 'PESI, Inc'));
    assert.match(pace.find((r) => r.provider_name === 'PESI, Inc')?.listed_website ?? '', /pesi\.com/);
  });

  it('plans NASBA pages from the Results count, not the visible pager', () => {
    const html = `<p>2176 Results</p><a href="sponsor-list?page=2">2</a><a href="sponsor-list?page=22">22</a>`;
    const plan = nasbaPagePlan(html, 'https://www.nasbaregistry.org/sponsor-list');
    assert.equal(plan.totalResults, 2176);
    assert.equal(plan.pageUrls.length, 22);
    assert.ok(plan.pageUrls[0]?.includes('page=1'));
    assert.ok(plan.pageUrls.at(-1)?.includes('page=22'));
  });

  it('parses ACPE WP JSON CPE providers and drops PharmD schools', () => {
    const raw = JSON.stringify([
      {
        title: { rendered: 'AchieveCE' },
        content: { rendered: '<a href="mailto:info@achievece.com">x</a>' },
        taxonomy_info: {
          'institution-type': [{ label: 'ACPE CPE Providers' }],
          'insitution-program': [{ label: 'CPE' }],
        },
      },
      {
        title: { rendered: 'College of Pharmacy' },
        content: { rendered: '' },
        taxonomy_info: {
          'institution-type': [{ label: 'Schools' }],
          'insitution-program': [{ label: 'PharmD' }],
        },
      },
      {
        title: { rendered: 'AcademicCME, LLC &#8211; (Joint Accreditation)' },
        content: { rendered: '<a href="mailto:info@academiccme.com">x</a>' },
        taxonomy_info: {
          'institution-type': [{ label: 'Joint Accredited Providers' }],
          'insitution-program': [{ label: 'CPE' }],
        },
      },
    ]);
    const rows = parseDirectoryHtml(
      'acpe',
      raw,
      ctx('acpe', 'https://www.acpe-accredit.org/wp-json/wp/v2/institution', 'pharmacist'),
    );
    assert.equal(rows.length, 2);
    assert.ok(rows.some((r) => r.provider_name === 'AchieveCE'));
    assert.ok(rows.some((r) => r.provider_name.includes('AcademicCME')));
    assert.equal(rows.find((r) => r.provider_name === 'AchieveCE')?.listed_website, 'https://achievece.com/');
  });

  it('parses ACPE program-lookup result cards', () => {
    const html = `
      <div class="result-item-content">
        <div class="institution-program">CPE</div>
        <h4><a href="https://www.acpe-accredit.org/institution/achievece/">AchieveCE</a></h4>
        <a href="mailto:info@achievece.com">x</a>
        <p><strong>Institution Type:</strong> ACPE CPE Providers</p>
      </div>
      <!-- View Button -->
      <div class="result-item-content">
        <div class="institution-program">PharmD</div>
        <h4>State University College of Pharmacy</h4>
        <p><strong>Institution Type:</strong> Schools</p>
      </div>
      <!-- View Button -->`;
    const rows = parseDirectoryHtml(
      'acpe',
      html,
      ctx('acpe', 'https://www.acpe-accredit.org/program-lookup/', 'pharmacist'),
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.provider_name, 'AchieveCE');
  });

  it('plans ACPE program-lookup pages from Found N Results', () => {
    const html = `<p>Found 249 Results</p>`;
    const plan = acpePagePlan(
      html,
      'https://www.acpe-accredit.org/program-lookup/?_insitution-program=cpe&_institution-type=providers',
    );
    assert.equal(plan.totalResults, 249);
    assert.equal(plan.pageUrls.length, 25);
    assert.ok(plan.pageUrls[0]?.includes('/program-lookup/?_insitution-program=cpe'));
    assert.ok(plan.pageUrls[1]?.includes('/program-lookup/page/2/'));
  });

  it('parses PACE renewal-header boxes and skips the FCLB catalog link', () => {
    const html = `
      <div class="renewal-box">
        <div class="col-md-12 renewal-header">PESI, Inc</div>
        <div class="col-md-12">Renewal Status: &nbsp;Active<br>
          <div class="col-md-12 renewal-links">
            <a href="https://rehab.pesi.com/" title="Visit PESI, Inc Website"></a>
            <a href="https://pacex.fclb.org/pages/course-catalog.php?ProviderId=109" title="View PESI, Inc Courses"></a>
          </div>
        </div>
      </div>`;
    const rows = parseDirectoryHtml(
      'pace',
      html,
      ctx('pace', 'https://pacex.fclb.org/pages/ProviderRenewalSchedule.php', 'chiropractor'),
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.provider_name, 'PESI, Inc');
    assert.match(rows[0]?.listed_website ?? '', /pesi\.com/);
  });

  it('parses COPE DataTables ajax JSON org rows', () => {
    const raw = JSON.stringify({
      draw: '1',
      recordsTotal: '2',
      data: [
        { org_name: 'Review of Optometry', website: 'www.reviewofoptometry.com' },
        { org_name: 'jeffrey d horn pllc', website: 'www.bestvisionforlife.com' },
      ],
    });
    const rows = parseDirectoryHtml(
      'cope',
      raw,
      ctx('cope', 'https://www.arbo.org/orgs/adminlist/ajax', 'optometrist'),
    );
    assert.equal(rows.length, 2);
    assert.equal(rows[0]?.provider_name, 'Review of Optometry');
    assert.match(rows[0]?.listed_website ?? '', /reviewofoptometry\.com/);
  });
});
