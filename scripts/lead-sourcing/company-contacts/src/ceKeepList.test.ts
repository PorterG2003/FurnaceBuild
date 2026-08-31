import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ceVendorsIcpPath, loadIcpConfig } from './config.js';
import {
  classifyContactTier,
  fillOrderForEmployeeCount,
  personTitlesForEmployeeCount,
  pickContactSlots,
} from './contactTier.js';
import {
  buildCeKeepList,
  companyNeedsCeSearch,
  keepApolloLead,
  mergeCeKeepAndGap,
  type HunterLeadRow,
} from './ceKeepList.js';
import type { LeadRow } from './types.js';

const ce = loadIcpConfig(ceVendorsIcpPath()).contact_search;
const ceTiers = ce.contact_tiers;

function lead(partial: Partial<LeadRow>): LeadRow {
  return {
    email: 'a@x.com',
    first_name: 'A',
    last_name: 'B',
    company_name: 'Co',
    website: 'co.com',
    linkedin_url: '',
    company_linkedin_url: '',
    contact_title: '',
    contact_tier: '',
    contact_pick_reason: '',
    employee_count: '100',
    industry: '',
    apollo_org_id: 'org',
    source_lists: 'test',
    ...partial,
  };
}

describe('CE vendor ICP', () => {
  it('classifies education and events as program, not sales', () => {
    assert.equal(classifyContactTier('Director of Education', ceTiers), 'program');
    assert.equal(classifyContactTier('VP of Events', ceTiers), 'program');
    assert.equal(classifyContactTier('VP of Sales', ceTiers), 'excluded');
    assert.equal(classifyContactTier('Director of Sales', ceTiers), 'unknown');
    assert.equal(classifyContactTier('VP of Sales Growth', ceTiers), 'excluded');
    assert.equal(classifyContactTier('VP of Education Sales, Success and Operations', ceTiers), 'excluded');
  });

  it('classifies CMO as marketing and excludes CRO/risk and product owner', () => {
    assert.equal(classifyContactTier('Chief Marketing Officer', ceTiers), 'marketing');
    assert.equal(classifyContactTier('Director of Marketing', ceTiers), 'marketing');
    assert.equal(classifyContactTier('Chief Risk Officer (CRO)', ceTiers), 'excluded');
    assert.equal(classifyContactTier('Product Owner', ceTiers), 'excluded');
    assert.equal(classifyContactTier('VP - Sales Enablement', ceTiers), 'excluded');
  });

  it('drops executives from fill order at 50+ and from Apollo title query', () => {
    assert.deepEqual(fillOrderForEmployeeCount('50', ce.fill_order), ['program', 'marketing']);
    assert.deepEqual(fillOrderForEmployeeCount('12', ce.fill_order), [
      'executive',
      'program',
      'marketing',
    ]);
    const largeTitles = personTitlesForEmployeeCount('400', ce);
    const smallTitles = personTitlesForEmployeeCount('12', ce);
    assert.equal(largeTitles.includes('CEO'), false);
    assert.equal(largeTitles.includes('VP of Sales'), false);
    assert.equal(largeTitles.includes('Director of Education'), true);
    assert.equal(smallTitles.includes('CEO'), true);
    assert.equal(smallTitles.includes('Director of Education'), true);
  });

  it('picks education before marketing when both exist', () => {
    const slots = pickContactSlots(
      [
        { id: 'mkt', title: 'CMO', has_email: true },
        { id: 'edu', title: 'Director of Education', has_email: true },
      ],
      { ...ce, fill_order: ['program', 'marketing'], max_contacts_per_company: 2 },
    );
    assert.equal(slots[0]?.id, 'edu');
    assert.equal(slots[0]?.tier, 'program');
    assert.equal(slots[1]?.id, 'mkt');
  });
});

describe('CE keep-list', () => {
  const icp = loadIcpConfig(ceVendorsIcpPath());

  it('keeps Apollo marketing/edu and small-company execs; drops VP Sales and large-company CEOs', () => {
    assert.equal(
      keepApolloLead(lead({ contact_title: 'CMO', employee_count: '400' }), icp),
      true,
    );
    assert.equal(
      keepApolloLead(lead({ contact_title: 'Director of Education', employee_count: '400' }), icp),
      true,
    );
    assert.equal(
      keepApolloLead(lead({ contact_title: 'President', employee_count: '15' }), icp),
      true,
    );
    assert.equal(
      keepApolloLead(lead({ contact_title: 'CEO', employee_count: '400' }), icp),
      false,
    );
    assert.equal(
      keepApolloLead(lead({ contact_title: 'VP of Sales', employee_count: '400' }), icp),
      false,
    );
  });

  it('passes through all Hunter MV-pass rows including 200+ CEOs and Product Owner', () => {
    const hunter: HunterLeadRow[] = [
      {
        company_name: 'Steel',
        company_domain: 'steeldynamics.com',
        employee_count: '15000',
        industry: 'steel',
        apollo_org_id: '1',
        source_lists: 'h',
        person_name: 'Pat Steel',
        person_title: 'CEO',
        email: 'pat@steeldynamics.com',
        linkedin: '',
        outcome: 'mv_pass',
      },
      {
        company_name: 'Schools',
        company_domain: 'fcps.edu',
        employee_count: '41000',
        industry: 'edu',
        apollo_org_id: '2',
        source_lists: 'h',
        person_name: 'Nantha Tangavelu',
        person_title: 'Product Owner',
        email: 'nantha.tangavelu@fcps.edu',
        linkedin: '',
        outcome: 'mv_pass',
      },
      {
        company_name: 'Skip',
        company_domain: 'skip.com',
        employee_count: '10',
        industry: '',
        apollo_org_id: '3',
        source_lists: 'h',
        person_name: 'No Email',
        person_title: 'CEO',
        email: '',
        linkedin: '',
        outcome: 'no_emails',
      },
    ];
    const kept = buildCeKeepList({ apolloLeads: [], hunterRows: hunter, icp });
    assert.equal(kept.length, 2);
    assert.ok(kept.some((r) => r.email === 'pat@steeldynamics.com'));
    assert.ok(kept.some((r) => r.email === 'nantha.tangavelu@fcps.edu'));
  });

  it('caps two contacts per domain and prefers program over hunter exec', () => {
    const apollo: LeadRow[] = [
      lead({
        email: 'edu@co.com',
        website: 'co.com',
        contact_title: 'Director of Education',
        employee_count: '80',
      }),
      lead({
        email: 'mkt@co.com',
        website: 'co.com',
        contact_title: 'CMO',
        employee_count: '80',
      }),
    ];
    const hunter: HunterLeadRow[] = [
      {
        company_name: 'Co',
        company_domain: 'co.com',
        employee_count: '80',
        industry: '',
        apollo_org_id: '1',
        source_lists: 'h',
        person_name: 'Big Chief',
        person_title: 'CEO',
        email: 'ceo@co.com',
        linkedin: '',
        outcome: 'mv_pass',
      },
    ];
    const kept = buildCeKeepList({ apolloLeads: apollo, hunterRows: hunter, icp });
    assert.equal(kept.length, 2);
    assert.ok(kept.some((r) => r.email === 'edu@co.com'));
    assert.ok(kept.some((r) => r.email === 'mkt@co.com'));
    assert.equal(kept.some((r) => r.email === 'ceo@co.com'), false);
  });

  it('unions keep+gap by email, prefers keep rows, and recaps at two per domain', () => {
    const keep = [
      lead({
        email: 'pres@small.com',
        website: 'small.com',
        contact_title: 'President',
        contact_tier: 'executive',
        contact_pick_reason: 'hunter_mv_pass',
        employee_count: '15',
      }),
      lead({
        email: 'cmo@big.com',
        website: 'big.com',
        contact_title: 'CMO',
        contact_tier: 'marketing',
        employee_count: '400',
      }),
    ];
    const gap = [
      lead({
        email: 'cmo@big.com',
        website: 'big.com',
        contact_title: 'Chief Marketing Officer',
        contact_tier: 'marketing',
        employee_count: '400',
      }),
      lead({
        email: 'edu@big.com',
        website: 'big.com',
        contact_title: 'Director of Education',
        contact_tier: 'program',
        employee_count: '400',
      }),
      lead({
        email: 'extra@big.com',
        website: 'big.com',
        contact_title: 'Director of Marketing',
        contact_tier: 'marketing',
        employee_count: '400',
      }),
      lead({
        email: 'mkt@small.com',
        website: 'small.com',
        contact_title: 'Director of Marketing',
        contact_tier: 'marketing',
        employee_count: '15',
      }),
    ];
    const merged = mergeCeKeepAndGap({ keepLeads: keep, gapLeads: gap, icp });
    assert.equal(merged.length, 4);
    assert.ok(merged.some((r) => r.email === 'pres@small.com' && r.contact_pick_reason === 'hunter_mv_pass'));
    assert.ok(merged.some((r) => r.email === 'mkt@small.com'));
    assert.ok(merged.some((r) => r.email === 'edu@big.com'));
    const bigCmo = merged.find((r) => r.email === 'cmo@big.com');
    assert.equal(bigCmo?.contact_title, 'CMO');
    assert.equal(merged.some((r) => r.email === 'extra@big.com'), false);
  });

  it('flags small exec-only companies as needing another search', () => {
    assert.equal(
      companyNeedsCeSearch(
        [lead({ contact_tier: 'executive', contact_title: 'President', employee_count: '15' })],
        '15',
      ),
      true,
    );
    assert.equal(
      companyNeedsCeSearch(
        [
          lead({ contact_tier: 'executive', employee_count: '15' }),
          lead({ contact_tier: 'marketing', employee_count: '15' }),
        ],
        '15',
      ),
      false,
    );
    assert.equal(
      companyNeedsCeSearch(
        [lead({ contact_tier: 'marketing', employee_count: '400' })],
        '400',
      ),
      true,
    );
    assert.equal(
      companyNeedsCeSearch(
        [
          lead({ contact_tier: 'marketing', email: 'a@x.com', employee_count: '400' }),
          lead({ contact_tier: 'program', email: 'b@x.com', employee_count: '400' }),
        ],
        '400',
      ),
      false,
    );
  });
});
