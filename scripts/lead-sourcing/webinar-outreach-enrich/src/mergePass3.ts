import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ensureDir, loadJson, readCsv, writeCsv, writeJson } from './io.js';
import { companyKey } from './pass2Prep.js';

const COLUMNS = [
  'platform',
  'provider',
  'company_name',
  'company_domain',
  'contact_email',
  'contact_full_name',
  'contact_first_name',
  'contact_last_name',
  'contact_title',
  'contact_linkedin',
  'company_linkedin',
  'person_name_source',
  'ad_library_url',
  'ad_id',
  'match_path',
  'contact_tier',
  'status',
  'pass2_stage',
  'pass3_stage',
];

function normalize(row: Record<string, string>, stage: string): Record<string, string> {
  const fullName =
    row.contact_full_name ||
    [row.contact_first_name, row.contact_last_name].filter(Boolean).join(' ').trim();
  return {
    platform: row.platform ?? '',
    provider: row.provider ?? '',
    company_name: row.company_name ?? '',
    company_domain: row.company_domain || row.prospeo_company_domain || '',
    contact_email: row.contact_email ?? '',
    contact_full_name: fullName,
    contact_first_name: row.contact_first_name ?? '',
    contact_last_name: row.contact_last_name ?? '',
    contact_title: row.contact_title ?? '',
    contact_linkedin: row.contact_linkedin ?? '',
    company_linkedin: row.company_linkedin || row.company_url || '',
    person_name_source: row.person_name_source ?? '',
    ad_library_url: row.ad_library_url ?? '',
    ad_id: row.ad_id ?? '',
    match_path: row.match_path ?? '',
    contact_tier: row.contact_tier ?? '',
    status: row.status || (row.contact_email ? 'matched' : 'no_match'),
    pass2_stage: row.pass2_stage ?? '',
    pass3_stage: stage,
  };
}

export function mergePass3(options: {
  pass1Dir: string;
  pass2Dir?: string;
  pass3Dir: string;
}): {
  path: string;
  prior_with_email: number;
  pass3_new_emails: number;
  total_with_email: number;
} {
  const pass1Dir = options.pass1Dir;
  const pass2Dir = options.pass2Dir ?? join(pass1Dir, 'pass2');
  const pass3Dir = ensureDir(options.pass3Dir);

  const baseCandidates = [
    join(pass2Dir, 'enriched_leads.csv'),
    join(pass1Dir, 'enriched_leads_pass2.csv'),
    join(pass1Dir, 'enriched_leads.csv'),
  ];
  const basePath = baseCandidates.find((p) => existsSync(p));
  if (!basePath) throw new Error('No prior enriched_leads.csv found');

  const byKey = new Map<string, Record<string, string>>();
  for (const row of readCsv(basePath)) {
    byKey.set(companyKey(row), normalize(row, row.pass3_stage || ''));
  }
  const prior = [...byKey.values()].filter((r) => r.contact_email).length;

  let pass3New = 0;
  for (const file of ['3_named_enriched.csv', '3_apollo_enriched.csv']) {
    const path = join(pass3Dir, file);
    if (!existsSync(path)) continue;
    const stage = file.startsWith('3_named') ? '3_named' : '3_apollo';
    for (const row of readCsv(path)) {
      if (!(row.contact_email || '').trim()) continue;
      const normalized = normalize({ ...row, provider: row.provider || (stage === '3_named' ? 'prospeo' : 'apollo') }, stage);
      const key = companyKey(normalized);
      if (byKey.get(key)?.contact_email) continue;
      byKey.set(key, normalized);
      pass3New += 1;
    }
  }

  const rows = [...byKey.values()];
  const outPath = join(pass3Dir, 'enriched_leads.csv');
  writeCsv(outPath, rows, COLUMNS);
  writeCsv(join(pass1Dir, 'enriched_leads_pass3.csv'), rows, COLUMNS);

  const withEmail = rows.filter((r) => r.contact_email).length;
  const summary = {
    prior_with_email: prior,
    pass3_new_emails: pass3New,
    total_with_email: withEmail,
    total_rows: rows.length,
    expand: loadJson(join(pass3Dir, 'expand_tally.json')),
    serper: loadJson(join(pass3Dir, 'serper_tally.json')),
    confirm: loadJson(join(pass3Dir, 'confirm_tally.json')),
    enrich: loadJson(join(pass3Dir, 'enrich_tally.json')),
  };
  writeJson(join(pass3Dir, 'spend_tally_pass3.json'), summary);
  console.log(JSON.stringify({ enriched_leads: outPath, ...summary }, null, 2));
  return {
    path: outPath,
    prior_with_email: prior,
    pass3_new_emails: pass3New,
    total_with_email: withEmail,
  };
}
