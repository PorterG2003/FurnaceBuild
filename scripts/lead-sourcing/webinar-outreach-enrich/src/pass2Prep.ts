import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ensureDir, readCsv, writeCsv, writeJson } from './io.js';

export const PASS2_MANIFEST_COLUMNS = [
  'platform',
  'company_name',
  'company_url',
  'company_domain',
  'landing_url',
  'landing_domain',
  'person_name',
  'ad_library_url',
  'ad_id',
  'has_usable_domain',
  'has_person_name',
  'bucket',
  'pass2_stage',
] as const;

export type Pass2Row = Record<(typeof PASS2_MANIFEST_COLUMNS)[number], string>;

export function companyKey(row: {
  company_name?: string;
  ad_id?: string;
  company_domain?: string;
}): string {
  const ad = (row.ad_id || '').trim();
  if (ad) return `ad:${ad}`;
  const domain = (row.company_domain || '').trim().toLowerCase();
  if (domain) return `domain:${domain}`;
  return `name:${(row.company_name || '').trim().toLowerCase()}`;
}

/** Companies that already have an email (pass1 enriched + any pass2/pass3 stage outputs). */
export function loadHaveEmailKeys(pass1Dir: string, ...extraDirs: Array<string | undefined>): Set<string> {
  const keys = new Set<string>();
  const enrichedPath = join(pass1Dir, 'enriched_leads.csv');
  if (existsSync(enrichedPath)) {
    for (const row of readCsv(enrichedPath)) {
      if (!(row.contact_email || '').trim()) continue;
      keys.add(companyKey(row));
    }
  }
  for (const p of [
    join(pass1Dir, 'enriched_leads_pass2.csv'),
    join(pass1Dir, 'enriched_leads_pass3.csv'),
  ]) {
    if (!existsSync(p)) continue;
    for (const row of readCsv(p)) {
      if (!(row.contact_email || '').trim()) continue;
      keys.add(companyKey(row));
    }
  }

  const stageFiles = [
    '2a_named_enriched.csv',
    '2b_linkedin_apollo_enriched.csv',
    '2c_meta_gated_prospeo_enriched.csv',
    '2d_name_only_enriched.csv',
    '3_named_enriched.csv',
    '3_apollo_enriched.csv',
    'enriched_leads.csv',
  ];

  for (const dir of extraDirs) {
    if (!dir || !existsSync(dir)) continue;
    for (const name of stageFiles) {
      const path = join(dir, name);
      if (!existsSync(path)) continue;
      for (const row of readCsv(path)) {
        if (!(row.contact_email || '').trim()) continue;
        keys.add(companyKey(row));
      }
    }
  }
  return keys;
}

function asPass2Row(
  row: Record<string, string>,
  bucket: string,
  stage: string,
): Pass2Row {
  return {
    platform: row.platform ?? '',
    company_name: row.company_name ?? '',
    company_url: row.company_url ?? '',
    company_domain: row.company_domain || row.landing_domain || '',
    landing_url: row.landing_url ?? '',
    landing_domain: row.landing_domain ?? '',
    person_name: row.person_name || row.person_name_source || '',
    ad_library_url: row.ad_library_url ?? '',
    ad_id: row.ad_id ?? '',
    has_usable_domain: row.has_usable_domain ?? (row.company_domain ? 'true' : 'false'),
    has_person_name:
      row.has_person_name ??
      (row.person_name || row.person_name_source ? 'true' : 'false'),
    bucket,
    pass2_stage: stage,
  };
}

export function estimatePass2(counts: {
  named: number;
  linkedinToApollo: number;
  metaGatedProspeo: number;
  nameOnly: number;
}) {
  return {
    stage_2a_named_prospeo: {
      rows: counts.named,
      estimated_credits_worst: counts.named,
      estimated_credits_likely: [Math.round(counts.named * 0.4), Math.round(counts.named * 0.7)],
    },
    stage_2b_linkedin_apollo: {
      rows: counts.linkedinToApollo,
      estimated_apollo_org_calls: counts.linkedinToApollo,
      estimated_email_credits: counts.linkedinToApollo,
      estimated_credits_worst: counts.linkedinToApollo * 2,
      estimated_credits_likely: [
        Math.round(counts.linkedinToApollo * 1.1),
        Math.round(counts.linkedinToApollo * 1.6),
      ],
    },
    stage_2c_meta_gated_prospeo: {
      rows: counts.metaGatedProspeo,
      estimated_credits_worst: counts.metaGatedProspeo * 3,
      estimated_credits_likely: [
        Math.round(counts.metaGatedProspeo * 0.8),
        Math.round(counts.metaGatedProspeo * 1.3),
      ],
    },
    stage_2d_name_only_prospeo: {
      rows: counts.nameOnly,
      estimated_credits_worst: counts.nameOnly * 3,
      estimated_credits_likely: [
        Math.round(counts.nameOnly * 0.4),
        Math.round(counts.nameOnly * 0.7),
      ],
    },
    hard_caps_recommended: {
      max_prospeo_credits: 200,
      max_apollo_org_calls: 80,
      max_enrichment_credits: 80,
    },
  };
}

/**
 * Build pass2 miss manifests from pass1 outputs.
 * Initial lists assume no pass2 hits yet; use `excludeHaveEmail` + refresh for post-stage lists.
 */
export function prepPass2(options: {
  pass1Dir: string;
  pass2Dir: string;
}): {
  pass2Dir: string;
  counts: Record<string, number>;
  estimates: ReturnType<typeof estimatePass2>;
} {
  const pass1Dir = options.pass1Dir;
  const pass2Dir = ensureDir(options.pass2Dir);
  const haveEmail = loadHaveEmailKeys(pass1Dir, pass2Dir);

  const linkedinCohort = readCsv(join(pass1Dir, 'linkedin_cohort.csv'));
  const linkedinEnriched = readCsv(join(pass1Dir, 'linkedin_enriched.csv'));
  const metaCohort = readCsv(join(pass1Dir, 'meta_cohort.csv'));
  const metaGated = readCsv(join(pass1Dir, 'meta_domain_gated.csv'));
  const metaEnriched = readCsv(join(pass1Dir, 'meta_enriched.csv'));

  const liByAd = new Map(linkedinEnriched.map((r) => [r.ad_id || companyKey(r), r]));
  const metaEmailDomains = new Set(
    metaEnriched
      .filter((r) => (r.contact_email || '').trim())
      .map((r) => (r.company_domain || '').toLowerCase()),
  );
  const metaEmailAds = new Set(
    metaEnriched.filter((r) => (r.contact_email || '').trim()).map((r) => r.ad_id || ''),
  );

  const named: Pass2Row[] = [];
  const linkedinToApollo: Pass2Row[] = [];
  const metaGatedToProspeo: Pass2Row[] = [];
  const nameOnly: Pass2Row[] = [];

  // LinkedIn misses
  for (const company of linkedinCohort) {
    const key = companyKey(company);
    if (haveEmail.has(key)) continue;
    const enriched = liByAd.get(company.ad_id) ?? liByAd.get(key);
    const hasEmail = Boolean(enriched?.contact_email?.trim());
    if (hasEmail) continue;

    const personName = company.person_name || enriched?.person_name_source || '';
    const hasDomain = company.has_usable_domain === 'true' || Boolean(company.company_domain?.trim());

    if (personName.trim()) {
      named.push(
        asPass2Row({ ...company, person_name: personName }, 'linkedin_named_miss', '2a'),
      );
    } else if (!hasDomain) {
      nameOnly.push(asPass2Row(company, 'linkedin_name_only', '2d'));
    } else {
      linkedinToApollo.push(asPass2Row(company, 'linkedin_miss_to_apollo', '2b'));
    }
    // Named LinkedIn misses also go to 2B if 2A fails — added at refresh time.
    if (personName.trim()) {
      linkedinToApollo.push(
        asPass2Row({ ...company, person_name: personName }, 'linkedin_named_miss_fallback', '2b'),
      );
    }
  }

  // Meta gated misses
  for (const company of metaGated) {
    const key = companyKey(company);
    if (haveEmail.has(key)) continue;
    const domain = (company.company_domain || '').toLowerCase();
    if (metaEmailDomains.has(domain) || metaEmailAds.has(company.ad_id)) continue;

    if (company.person_name?.trim()) {
      named.push(asPass2Row(company, 'meta_gated_named_miss', '2a'));
    }
    metaGatedToProspeo.push(asPass2Row(company, 'meta_gated_miss', '2c'));
  }

  // Meta no-domain deferred
  for (const company of metaCohort) {
    if (company.has_usable_domain === 'true') continue;
    const key = companyKey(company);
    if (haveEmail.has(key)) continue;
    if (metaEmailAds.has(company.ad_id)) continue;

    if (company.person_name?.trim()) {
      named.push(asPass2Row(company, 'meta_no_domain_named', '2a'));
    }
    nameOnly.push(asPass2Row(company, 'meta_no_domain', '2d'));
  }

  // Dedupe each list by company key (prefer first)
  const dedupe = (rows: Pass2Row[]): Pass2Row[] => {
    const seen = new Set<string>();
    const out: Pass2Row[] = [];
    for (const row of rows) {
      const key = companyKey(row);
      if (haveEmail.has(key)) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(row);
    }
    return out;
  };

  const namedDeduped = dedupe(named);
  // 2B should exclude companies that only appear as named (they'll be tried in 2A first).
  // Initial 2B list = LinkedIn misses without email; includes named as fallback rows but
  // runner will skip have-email after 2A. Keep unique LinkedIn misses for Apollo.
  const linkedinApolloDeduped = dedupe(
    linkedinToApollo.filter((r) => r.platform === 'linkedin'),
  );
  const metaGatedDeduped = dedupe(metaGatedToProspeo);
  const nameOnlyDeduped = dedupe(nameOnly);

  writeCsv(
    join(pass2Dir, 'named_prospeo.csv'),
    namedDeduped,
    [...PASS2_MANIFEST_COLUMNS],
  );
  writeCsv(
    join(pass2Dir, 'linkedin_to_apollo.csv'),
    linkedinApolloDeduped,
    [...PASS2_MANIFEST_COLUMNS],
  );
  writeCsv(
    join(pass2Dir, 'meta_gated_to_prospeo.csv'),
    metaGatedDeduped,
    [...PASS2_MANIFEST_COLUMNS],
  );
  writeCsv(join(pass2Dir, 'name_only.csv'), nameOnlyDeduped, [...PASS2_MANIFEST_COLUMNS]);

  // Apollo companies.csv for 2B
  writeCsv(
    join(pass2Dir, '2b_apollo', 'companies.csv'),
    linkedinApolloDeduped.map((r) => ({
      company_name: r.company_name,
      company_domain: r.company_domain,
      source_lists: `webinar-pass2-linkedin|${r.ad_id}|${r.ad_library_url}`,
      person_name: r.person_name,
      ad_library_url: r.ad_library_url,
      ad_id: r.ad_id,
      platform: r.platform,
    })),
    [
      'company_name',
      'company_domain',
      'source_lists',
      'person_name',
      'ad_library_url',
      'ad_id',
      'platform',
    ],
  );

  const counts = {
    named: namedDeduped.length,
    linkedinToApollo: linkedinApolloDeduped.length,
    metaGatedProspeo: metaGatedDeduped.length,
    nameOnly: nameOnlyDeduped.length,
  };
  const estimates = estimatePass2(counts);
  writeJson(join(pass2Dir, 'prep_estimates.json'), {
    pass1_dir: pass1Dir,
    pass2_dir: pass2Dir,
    have_email_skipped: haveEmail.size,
    counts,
    estimates,
  });

  return {
    pass2Dir,
    counts: {
      named: counts.named,
      linkedin_to_apollo: counts.linkedinToApollo,
      meta_gated_to_prospeo: counts.metaGatedProspeo,
      name_only: counts.nameOnly,
      have_email_skipped: haveEmail.size,
    },
    estimates,
  };
}
