import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assignFitTier, assignHostTier, aggregateProspects, companyKey, isHostKeepLeak } from './tiers.js';
import { buildCoverageReport } from './coverageReport.js';
import type { FitRecord } from '../lib/types.js';

function row(partial: Partial<FitRecord> & Pick<FitRecord, 'provider_name'>): FitRecord {
  return {
    source_directory: 'nbcc',
    accreditor: 'NBCC',
    audience_profession: 'counselor',
    source_url: 'https://example.test/dir',
    listed_website: 'https://vendor.example/',
    entity_class: 'commercial_vendor',
    company_sells_what: 'software',
    class_reason: 'demo',
    homepage_url: 'https://vendor.example/',
    audience_relationship: 'customer',
    has_formal_grant_program: false,
    registration_host_domain: 'vendor.example',
    registration_kind: 'own_domain',
    registration_url: 'https://vendor.example/register',
    is_free: true,
    self_provided: true,
    ce_page_url: 'https://vendor.example/ce',
    activity_title: 'CE',
    ce_formats: 'live_online',
    primary_ce_format: 'live_online',
    has_live_online: true,
    needs_review: false,
    source_kind: 'directory',
    ...partial,
  };
}

describe('fit tiers', () => {
  it('ranks self-provided own-domain free vendors first', () => {
    assert.equal(
      assignFitTier({
        entity_class: 'commercial_vendor',
        self_provided: true,
        is_free: true,
        registration_kind: 'own_domain',
        has_formal_grant_program: false,
        has_live_online: true,
        source_kind: 'directory',
      }),
      1,
    );
    assert.equal(
      assignFitTier({
        entity_class: 'commercial_vendor',
        self_provided: true,
        is_free: true,
        registration_kind: 'third_party',
        has_formal_grant_program: false,
        has_live_online: true,
        source_kind: 'directory',
      }),
      2,
    );
  });

  it('promotes unknown-free own-domain vendor to tier 1', () => {
    assert.equal(
      assignFitTier({
        entity_class: 'commercial_vendor',
        self_provided: true,
        is_free: null,
        registration_kind: 'own_domain',
        has_formal_grant_program: false,
        has_live_online: true,
        source_kind: 'directory',
      }),
      1,
    );
  });

  it('promotes unknown-free third-party vendor to tier 2', () => {
    assert.equal(
      assignFitTier({
        entity_class: 'commercial_vendor',
        self_provided: true,
        is_free: null,
        registration_kind: 'third_party',
        has_formal_grant_program: false,
        has_live_online: true,
        source_kind: 'directory',
      }),
      2,
    );
  });

  it('blocks paid vendors from candidate tiers', () => {
    assert.equal(
      assignFitTier({
        entity_class: 'commercial_vendor',
        self_provided: true,
        is_free: false,
        registration_kind: 'own_domain',
        has_formal_grant_program: false,
        has_live_online: true,
        source_kind: 'directory',
      }),
      0,
    );
  });

  it('promotes non-self-provided vendor with own-domain to tier 1', () => {
    assert.equal(
      assignFitTier({
        entity_class: 'commercial_vendor',
        self_provided: false,
        is_free: true,
        registration_kind: 'own_domain',
        has_formal_grant_program: false,
        has_live_online: true,
        source_kind: 'directory',
      }),
      1,
    );
  });

  it('promotes non-self-provided vendor with third-party to tier 2', () => {
    assert.equal(
      assignFitTier({
        entity_class: 'commercial_vendor',
        self_provided: false,
        is_free: null,
        registration_kind: 'third_party',
        has_formal_grant_program: false,
        has_live_online: true,
        source_kind: 'directory',
      }),
      2,
    );
  });

  it('sorts self-provided above non-self-provided within the same tier', () => {
    const selfProv = row({ provider_name: 'SelfProv Corp' });
    const sponsored = row({
      provider_name: 'Sponsored Corp',
      self_provided: false,
    });
    const { prospects } = aggregateProspects([sponsored, selfProv]);
    assert.equal(prospects[0]?.company_name, 'SelfProv Corp');
    assert.equal(prospects[1]?.company_name, 'Sponsored Corp');
    assert.equal(prospects[0]?.fit_tier, 1);
    assert.equal(prospects[1]?.fit_tier, 1);
  });

  it('promotes in-person-only and blank-format vendors to candidate tiers', () => {
    assert.equal(
      assignFitTier({
        entity_class: 'commercial_vendor',
        self_provided: true,
        is_free: true,
        registration_kind: 'own_domain',
        has_formal_grant_program: false,
        has_live_online: false,
        source_kind: 'directory',
      }),
      1,
    );
    assert.equal(
      assignFitTier({
        entity_class: 'commercial_vendor',
        self_provided: true,
        is_free: null,
        registration_kind: 'unknown',
        has_formal_grant_program: false,
        has_live_online: false,
        source_kind: 'directory',
      }),
      2,
    );
  });

  it('does not cut grant-flagged vendors from candidate tiers', () => {
    assert.equal(
      assignFitTier({
        entity_class: 'commercial_vendor',
        self_provided: true,
        is_free: true,
        registration_kind: 'own_domain',
        has_formal_grant_program: true,
        has_live_online: true,
        source_kind: 'directory',
      }),
      1,
    );
  });

  it('sorts self-provided above live-online within the same tier', () => {
    const selfNoLive = row({
      provider_name: 'Self No Live',
      has_live_online: false,
      ce_formats: 'in_person',
      primary_ce_format: 'in_person',
    });
    const notSelfLive = row({
      provider_name: 'Sponsored Live',
      self_provided: false,
      has_live_online: true,
      ce_formats: 'live_online',
    });
    const { prospects } = aggregateProspects([notSelfLive, selfNoLive]);
    assert.equal(prospects[0]?.company_name, 'Self No Live');
    assert.equal(prospects[1]?.company_name, 'Sponsored Live');
  });

  it('strips platform-URL live_online but still keeps the listed vendor as a candidate', () => {
    const platformRow = row({
      provider_name: 'BNP Boilerplate Corp',
      ce_page_url: 'https://continuingeducation.bnpmedia.com/sponsors/bnp-boilerplate-corp',
      source_url: 'https://continuingeducation.bnpmedia.com/sitemap.xml',
      ce_formats: 'live_online',
      has_live_online: true,
      is_free: null as unknown as boolean,
      registration_kind: 'third_party',
    });
    const { prospects } = aggregateProspects([platformRow]);
    const p = prospects.find((r) => /bnp boilerplate/i.test(r.company_name));
    assert.ok(p, 'prospect should exist');
    assert.equal(p.has_live_online, false, 'platform live_online should be stripped');
    assert.equal(p.fit_tier, 2);
  });

  it('promotes manufacturer-directory trade associations to vendor candidates', () => {
    const { prospects } = aggregateProspects([
      row({
        provider_name: 'Steel Door Institute',
        entity_class: 'society',
        source_directory: 'arcat',
        self_provided: false,
        has_live_online: false,
        ce_formats: '',
        registration_kind: 'unknown',
      }),
    ]);
    assert.equal(prospects[0]?.entity_class, 'commercial_vendor');
    assert.equal(prospects[0]?.fit_tier, 2);
    assert.equal(prospects[0]?.audience_relationship, 'partner');
  });

  it('ranks own-domain vendors above grant-search frequency', () => {
    const vendor = row({ provider_name: 'TherapyMatch Inc.', activity_title: 'One CE' });
    const pharma = row({
      provider_name: 'Novo Nordisk',
      self_provided: false,
      is_free: true,
      registration_kind: 'unknown',
      has_formal_grant_program: true,
      source_kind: 'grant_search',
      entity_class: 'commercial_vendor',
    });
    const manyPharma = [pharma, pharma, pharma, pharma, pharma];
    const { prospects } = aggregateProspects([vendor, ...manyPharma]);
    assert.equal(prospects[0]?.company_name, 'TherapyMatch Inc.');
    assert.equal(prospects[0]?.fit_tier, 1);
    const novo = prospects.find((p) => p.company_name === 'Novo Nordisk');
    assert.equal(novo?.fit_tier, 2);
    assert.ok((novo?.activity_count ?? 0) > (prospects[0]?.activity_count ?? 0));
  });

  it('keeps CE shops and public-webinar firms; drops manufacturers and on-demand-only', () => {
    assert.equal(
      assignHostTier({
        entity_class: 'education_company',
        registration_kind: 'own_domain',
        has_live_online: true,
      }),
      1,
    );
    assert.equal(
      assignHostTier({
        entity_class: 'commercial_vendor',
        class_reason: 'professional firm name',
        registration_kind: 'own_domain',
        has_live_online: true,
      }),
      2,
    );
    assert.equal(
      assignHostTier({
        entity_class: 'commercial_vendor',
        class_reason: 'professional firm name',
        registration_kind: 'own_domain',
        has_live_online: false,
      }),
      0,
    );
    assert.equal(
      assignHostTier({
        entity_class: 'commercial_vendor',
        class_reason: 'GreenCE manufacturer sponsor list',
        registration_kind: 'third_party',
        has_live_online: true,
      }),
      0,
    );
    assert.equal(
      assignHostTier({
        entity_class: 'unknown',
        source_directory: 'ce_platform',
        registration_kind: 'own_domain',
        has_live_online: false,
      }),
      1,
    );
    assert.equal(
      assignHostTier({
        entity_class: 'society',
        registration_kind: 'own_domain',
        has_live_online: true,
      }),
      0,
    );
    assert.equal(
      assignHostTier({
        entity_class: 'education_company',
        registration_kind: 'unknown',
        has_live_online: false,
        primary_ce_format: 'unknown',
        ce_formats: '',
      }),
      1,
    );
    assert.equal(
      assignHostTier({
        entity_class: 'education_company',
        registration_kind: 'own_domain',
        has_live_online: false,
        primary_ce_format: 'on_demand',
        ce_formats: 'on_demand',
      }),
      0,
    );
    assert.equal(
      assignHostTier({
        entity_class: 'education_company',
        registration_kind: 'own_domain',
        has_live_online: true,
        primary_ce_format: 'live_online',
        ce_formats: 'live_online|on_demand',
      }),
      1,
    );
    assert.equal(
      assignHostTier({
        entity_class: 'education_company',
        registration_kind: 'own_domain',
        has_live_online: false,
        primary_ce_format: 'in_person',
        ce_formats: 'in_person|on_demand',
      }),
      1,
    );
  });

  it('merges Inc suffix variants', () => {
    assert.equal(companyKey('TherapyMatch Inc.'), companyKey('TherapyMatch'));
  });

  it('flags university and association name leaks for host_keep', () => {
    assert.equal(isHostKeepLeak('UCLA Counseling and Psychological Services (CAPS)'), true);
    assert.equal(isHostKeepLeak("Alzheimer's Foundation of America, The"), true);
    assert.equal(isHostKeepLeak('EMDR Center of the Rockies'), false);
    assert.equal(isHostKeepLeak('Association for Advanced Training in Behavioral Sciences'), false);
    assert.equal(isHostKeepLeak('Alabama Pharmacy Association Research & Education Foundation'), true);
    assert.equal(isHostKeepLeak('The College of New Jersey: Department of Online Counselor Education'), true);
    assert.equal(isHostKeepLeak('optometric education society'), true);
    assert.equal(isHostKeepLeak('Connecticut Chiropractic Council'), true);
    assert.equal(isHostKeepLeak('American College of Mental Health Education'), true);
  });

  it('coverage report leads with composition keys', () => {
    const { prospects } = aggregateProspects([
      row({ provider_name: 'TherapyMatch Inc.' }),
      row({
        provider_name: 'Novo Nordisk',
        self_provided: false,
        has_formal_grant_program: true,
        source_kind: 'grant_search',
        registration_kind: 'unknown',
      }),
    ]);
    const report = buildCoverageReport({
      directoryRows: 8,
      classifiedRows: 8,
      fitRows: 8,
      hostActivities: 1,
      grantActivities: 2,
      unmatched: 1,
      prospects,
    });
    assert.match(report.banner, /not a census/i);
    assert.ok('self_provided_share' in report.composition);
    assert.ok('audience_relationship' in report.composition);
    assert.ok('tier_1' in report.funnel);
  });
});
