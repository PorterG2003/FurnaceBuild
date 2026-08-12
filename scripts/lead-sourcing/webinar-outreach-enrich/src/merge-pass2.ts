import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ensureDir, loadJson, readCsv, writeCsv, writeJson } from './io.js';
import { outputDir, parseArgs } from './env.js';
import { companyKey } from './pass2Prep.js';

const COMBINED_COLUMNS = [
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
];

function normalizePass2Row(row: Record<string, string>): Record<string, string> {
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
  };
}

export function mergePass2(options: {
  pass1Dir: string;
  pass2Dir: string;
}): {
  path: string;
  pass1_with_email: number;
  pass2_new_emails: number;
  total_with_email: number;
  total_rows: number;
} {
  const pass1Dir = options.pass1Dir;
  const pass2Dir = ensureDir(options.pass2Dir);
  const basePath = join(pass1Dir, 'enriched_leads.csv');
  if (!existsSync(basePath)) {
    throw new Error(`Missing ${basePath}`);
  }

  const byKey = new Map<string, Record<string, string>>();
  for (const row of readCsv(basePath)) {
    const normalized = normalizePass2Row({ ...row, pass2_stage: row.pass2_stage || 'pass1' });
    byKey.set(companyKey(normalized), normalized);
  }
  const pass1WithEmail = [...byKey.values()].filter((r) => r.contact_email).length;

  let pass2New = 0;
  const stageFiles = [
    '2a_named_enriched.csv',
    '2b_linkedin_apollo_enriched.csv',
    '2c_meta_gated_prospeo_enriched.csv',
    '2d_name_only_enriched.csv',
  ];

  for (const file of stageFiles) {
    const path = join(pass2Dir, file);
    if (!existsSync(path)) continue;
    for (const row of readCsv(path)) {
      if (!(row.contact_email || '').trim()) continue;
      const normalized = normalizePass2Row(row);
      const key = companyKey(normalized);
      const existing = byKey.get(key);
      if (existing?.contact_email) continue;
      byKey.set(key, normalized);
      pass2New += 1;
    }
  }

  const rows = [...byKey.values()];
  const outPath = join(pass2Dir, 'enriched_leads.csv');
  // Also refresh pass1 enriched_leads with combined (pass2 is source of truth for combined)
  writeCsv(outPath, rows, COMBINED_COLUMNS);
  writeCsv(join(pass1Dir, 'enriched_leads_pass2.csv'), rows, COMBINED_COLUMNS);

  const tallies = {
    '2a': loadJson(join(pass2Dir, '2a_spend_tally.json')),
    '2b': loadJson(join(pass2Dir, '2b_spend_tally.json')),
    '2c': loadJson(join(pass2Dir, '2c_spend_tally.json')),
    '2d': loadJson(join(pass2Dir, '2d_spend_tally.json')),
  };

  const withEmail = rows.filter((r) => r.contact_email).length;
  const summary = {
    pass1_with_email: pass1WithEmail,
    pass2_new_emails: pass2New,
    total_with_email: withEmail,
    total_rows: rows.length,
    by_platform: {
      linkedin: rows.filter((r) => r.platform === 'linkedin' && r.contact_email).length,
      meta: rows.filter((r) => r.platform === 'meta' && r.contact_email).length,
    },
    stages: tallies,
  };

  writeJson(join(pass2Dir, 'spend_tally_pass2.json'), summary);
  writeJson(join(pass1Dir, 'spend_tally_combined.json'), {
    pass1: loadJson(join(pass1Dir, 'spend_tally.json')),
    pass2: summary,
  });

  console.log(JSON.stringify({ enriched_leads: outPath, ...summary }, null, 2));
  return {
    path: outPath,
    pass1_with_email: pass1WithEmail,
    pass2_new_emails: pass2New,
    total_with_email: withEmail,
    total_rows: rows.length,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const pass1Dir =
    typeof args['pass1-dir'] === 'string'
      ? args['pass1-dir']
      : join(outputDir, 'runs', 'pass1');
  const pass2Dir =
    typeof args['pass2-dir'] === 'string'
      ? args['pass2-dir']
      : join(pass1Dir, 'pass2');
  mergePass2({ pass1Dir, pass2Dir });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
