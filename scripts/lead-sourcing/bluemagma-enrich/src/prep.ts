import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseCliArgs, createRunDir, truncateRows } from './lib/cli.js';
import { loadEnv, packageRoot, defaultInputCsv } from './lib/env.js';
import { readCsv, writeCsv } from './lib/csv.js';
import { ensureDir, writeJson } from './lib/io.js';
import {
  PERSON_COLUMNS,
  COMPANY_COLUMNS,
  companyKey,
  normalizeLinkedInCompanyUrl,
} from './lib/types.js';

function uniqJoin(values: string[], max = 8, maxChars = 500): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const v = raw.trim();
    if (!v) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
    if (out.length >= max) break;
  }
  const joined = out.join(' | ');
  return joined.length <= maxChars ? joined : `${joined.slice(0, maxChars)}…`;
}

export function prepCompanies(options: {
  inputCsv: string;
  runDir: string;
  maxRows?: number | null;
}): { companies: number; unresolvable: number; people: number } {
  const runDir = ensureDir(options.runDir);
  let people = readCsv(options.inputCsv);
  people = truncateRows(people, options.maxRows ?? null);

  const peoplePath = join(runDir, 'people.csv');
  writeCsv(peoplePath, people, PERSON_COLUMNS);

  type Agg = {
    company_key: string;
    company_name: string;
    company_linkedin: string;
    person_count: number;
    headlines: string[];
    titles: string[];
  };
  const byKey = new Map<string, Agg>();
  const unresolvable: Record<string, string>[] = [];

  for (const row of people) {
    const name = (row.company ?? '').trim();
    const li = normalizeLinkedInCompanyUrl(row.company_linkedin ?? '');
    const key = companyKey(name, li);
    if (!key) {
      unresolvable.push(row);
      continue;
    }
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        company_key: key,
        company_name: name,
        company_linkedin: li,
        person_count: 1,
        headlines: [row.headline ?? ''],
        titles: [row.title ?? ''],
      });
    } else {
      existing.person_count += 1;
      if (!existing.company_name && name) existing.company_name = name;
      if (!existing.company_linkedin && li) existing.company_linkedin = li;
      existing.headlines.push(row.headline ?? '');
      existing.titles.push(row.title ?? '');
    }
  }

  const companies = [...byKey.values()].map((c) => ({
    company_key: c.company_key,
    company_name: c.company_name,
    company_linkedin: c.company_linkedin,
    person_count: String(c.person_count),
    sample_headlines: uniqJoin(c.headlines),
    sample_titles: uniqJoin(c.titles),
  }));

  writeCsv(join(runDir, 'companies.csv'), companies, COMPANY_COLUMNS);
  writeCsv(join(runDir, 'companies_unresolvable.csv'), unresolvable, PERSON_COLUMNS);
  writeJson(join(runDir, 'prep_summary.json'), {
    people: people.length,
    unique_companies: companies.length,
    unresolvable_people: unresolvable.length,
  });

  console.error(
    `[prep] people=${people.length} companies=${companies.length} unresolvable=${unresolvable.length} → ${runDir}`,
  );
  return { companies: companies.length, unresolvable: unresolvable.length, people: people.length };
}

async function main(): Promise<void> {
  loadEnv();
  const cli = parseCliArgs();
  const input = resolve(cli.input ?? defaultInputCsv());
  if (!existsSync(input)) throw new Error(`Input CSV not found: ${input}`);
  const runDir = resolve(cli.runDir ?? join(packageRoot, createRunDir()));
  prepCompanies({ inputCsv: input, runDir, maxRows: cli.maxRows });
}

const invoked = process.argv[1]?.includes('prep.ts');
if (invoked) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
