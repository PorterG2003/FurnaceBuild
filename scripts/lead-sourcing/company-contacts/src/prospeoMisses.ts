import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { readCsv, writeCsv } from '../../webinar-hosts/src/lib/csv.js';
import { ensureEnv } from '../../webinar-outreach-enrich/src/env.js';
import { enrichPersonEmailOnly } from '../../webinar-outreach-enrich/src/prospeo.js';
import { writeJson, loadJson } from '../../webinar-outreach-enrich/src/io.js';
import { LEAD_COLUMNS, type NamedMissRow } from './types.js';

export const PROSPEO_MISS_COLUMNS = [
  ...LEAD_COLUMNS,
  'email_source',
  'prospeo_status',
  'error',
] as const;

type MissCheckpoint = {
  next_index: number;
  credits_spent: number;
  results: Record<string, string>[];
};

export function loadNamedMisses(runDir: string): NamedMissRow[] {
  const path = join(runDir, 'named_misses.csv');
  if (!existsSync(path)) return [];
  return readCsv(path) as NamedMissRow[];
}

export async function enrichProspeoMisses(options: {
  runDir: string;
  dryRun?: boolean;
  live?: boolean;
  maxRows?: number | null;
  maxProspeoCredits?: number | null;
}): Promise<{ credits: number; filled: number }> {
  const runDir = resolve(options.runDir);
  let rows = loadNamedMisses(runDir);
  if (options.maxRows != null) rows = rows.slice(0, options.maxRows);

  if (options.dryRun || !options.live) {
    const estimate = {
      dry_run: true,
      vendor: 'Prospeo',
      named_misses: loadNamedMisses(runDir).length,
      this_wave: rows.length,
      max_prospeo_credits: options.maxProspeoCredits,
      note: 'Run after Apollo find-contacts. Live requires --live after spend OK. Sample before full.',
    };
    console.log(JSON.stringify(estimate, null, 2));
    writeJson(join(runDir, 'prospeo_dry_run.json'), estimate);
    return { credits: 0, filled: 0 };
  }

  await ensureEnv({ apollo: false, prospeo: true, serper: false });
  if (!process.env.PROSPEO_API_KEY?.trim()) {
    throw new Error('PROSPEO_API_KEY not available');
  }

  const checkpointPath = join(runDir, 'prospeo_checkpoint.json');
  const outPath = join(runDir, 'prospeo_filled.csv');
  let checkpoint = loadJson<MissCheckpoint>(checkpointPath) ?? {
    next_index: 0,
    credits_spent: 0,
    results: [],
  };

  const cap = options.maxProspeoCredits;
  for (let i = checkpoint.next_index; i < rows.length; i++) {
    if (cap != null && checkpoint.credits_spent >= cap) {
      console.error(`[prospeo-misses] hit max credits ${checkpoint.credits_spent} at ${i}/${rows.length}`);
      break;
    }
    const row = rows[i]!;
    const name = `${row.first_name ?? ''} ${row.last_name ?? ''}`.trim();
    console.error(`[prospeo] ${i + 1}/${rows.length} ${name} @ ${row.company_name}`);

    let email = '';
    let status = 'no_match';
    let error = '';
    try {
      const result = await enrichPersonEmailOnly({
        firstName: row.first_name,
        lastName: row.last_name,
        fullName: name || undefined,
        linkedinUrl: row.linkedin_url || undefined,
        companyName: row.company_name,
        companyWebsite: row.company_domain,
      });
      checkpoint.credits_spent += 1;
      email = result?.person?.email?.email?.trim().toLowerCase() ?? '';
      status = email ? 'ok' : 'no_email';
    } catch (e) {
      checkpoint.credits_spent += 1;
      error = e instanceof Error ? e.message : String(e);
      status = 'error';
    }

    const lead: Record<string, string> = {
      email,
      first_name: row.first_name ?? '',
      last_name: row.last_name ?? '',
      company_name: row.company_name ?? '',
      website: row.company_domain ?? '',
      linkedin_url: row.linkedin_url ?? '',
      company_linkedin_url: '',
      contact_title: row.contact_title ?? '',
      contact_tier: 'sales_marketing',
      contact_pick_reason: 'prospeo_miss',
      employee_count: row.employee_count ?? '',
      industry: '',
      apollo_org_id: row.apollo_org_id ?? '',
      source_lists: row.source_lists ?? '',
      email_source: email ? 'prospeo' : '',
      prospeo_status: status,
      error,
    };
    checkpoint.results.push(lead);
    checkpoint.next_index = i + 1;
    writeJson(checkpointPath, checkpoint);
    writeCsv(outPath, checkpoint.results, [...PROSPEO_MISS_COLUMNS]);
    await new Promise((r) => setTimeout(r, 200));
  }

  const filled = checkpoint.results.filter((r) => r.email).length;
  writeJson(join(runDir, 'prospeo_tally.json'), {
    credits_spent: checkpoint.credits_spent,
    filled,
    attempted: checkpoint.results.length,
  });
  return { credits: checkpoint.credits_spent, filled };
}
