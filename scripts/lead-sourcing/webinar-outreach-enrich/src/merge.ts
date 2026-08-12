import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ensureDir, readCsv, writeCsv, writeJson, loadJson } from './io.js';
import { outputDir, parseArgs } from './env.js';

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
];

export function mergeEnriched(runDir: string): {
  path: string;
  rows: number;
  with_email: number;
} {
  const dir = ensureDir(runDir);
  const linkedinPath = join(dir, 'linkedin_enriched.csv');
  const metaPath = join(dir, 'meta_enriched.csv');

  const rows: Record<string, string>[] = [];

  if (existsSync(linkedinPath)) {
    for (const row of readCsv(linkedinPath)) {
      rows.push({
        platform: 'linkedin',
        provider: 'prospeo',
        company_name: row.company_name ?? '',
        company_domain: row.company_domain || row.prospeo_company_domain || '',
        contact_email: row.contact_email ?? '',
        contact_full_name: row.contact_full_name ?? '',
        contact_first_name: '',
        contact_last_name: '',
        contact_title: row.contact_title ?? '',
        contact_linkedin: row.contact_linkedin ?? '',
        company_linkedin: row.company_url ?? '',
        person_name_source: row.person_name_source ?? '',
        ad_library_url: row.ad_library_url ?? '',
        ad_id: row.ad_id ?? '',
        match_path: row.match_path ?? '',
        contact_tier: '',
        status: row.status ?? '',
      });
    }
  }

  if (existsSync(metaPath)) {
    for (const row of readCsv(metaPath)) {
      const fullName = [row.contact_first_name, row.contact_last_name]
        .filter(Boolean)
        .join(' ')
        .trim();
      rows.push({
        platform: 'meta',
        provider: 'apollo',
        company_name: row.company_name ?? '',
        company_domain: row.company_domain ?? '',
        contact_email: row.contact_email ?? '',
        contact_full_name: fullName,
        contact_first_name: row.contact_first_name ?? '',
        contact_last_name: row.contact_last_name ?? '',
        contact_title: row.contact_title ?? '',
        contact_linkedin: row.contact_linkedin ?? '',
        company_linkedin: row.company_linkedin ?? '',
        person_name_source: row.person_name_source ?? '',
        ad_library_url: row.ad_library_url ?? '',
        ad_id: '',
        match_path: row.contact_pick_reason ?? '',
        contact_tier: row.contact_tier ?? '',
        status: row.contact_email ? 'matched' : 'no_email',
      });
    }
  }

  const outPath = join(dir, 'enriched_leads.csv');
  writeCsv(outPath, rows, COMBINED_COLUMNS);

  const linkedinTally = loadJson<Record<string, unknown>>(join(dir, 'linkedin_spend_tally.json'));
  const metaTally = loadJson<Record<string, unknown>>(join(dir, 'meta_spend_tally.json'));
  const withEmail = rows.filter((r) => Boolean(r.contact_email)).length;

  writeJson(join(dir, 'spend_tally.json'), {
    linkedin_prospeo: linkedinTally,
    meta_apollo: metaTally,
    combined: {
      rows: rows.length,
      with_email: withEmail,
      linkedin_rows: rows.filter((r) => r.platform === 'linkedin').length,
      meta_rows: rows.filter((r) => r.platform === 'meta').length,
    },
  });

  console.log(
    JSON.stringify(
      {
        enriched_leads: outPath,
        rows: rows.length,
        with_email: withEmail,
      },
      null,
      2,
    ),
  );

  return { path: outPath, rows: rows.length, with_email: withEmail };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const runDir =
    typeof args['run-dir'] === 'string'
      ? args['run-dir']
      : join(outputDir, 'runs', 'latest');
  mergeEnriched(runDir);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
