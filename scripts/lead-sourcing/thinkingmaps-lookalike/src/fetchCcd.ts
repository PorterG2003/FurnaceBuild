import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseCliArgs } from './lib/cli.js';
import { dataDir, fixturesDir, loadEnv, packageRoot, useFixtures } from './lib/env.js';
import { fetchJson } from './lib/http.js';
import { ensureDir, loadJson, writeJson } from './lib/io.js';
import { sleepWithJitter } from './lib/retry.js';
import { attachEllSpec, joinSaipe, saveCcdUniverse } from './ioCcd.js';
import type { CcdDistrict } from './types.js';

const DIRECTORY_URL = 'https://educationdata.urban.org/api/v1/school-districts/ccd/directory/2024/';
const SAIPE_URL = 'https://educationdata.urban.org/api/v1/school-districts/saipe/2024/';
const ELL_FALLBACK_URL = 'https://educationdata.urban.org/api/v1/school-districts/ccd/directory/2021/';

type UrbanPage = {
  count?: number;
  next?: string | null;
  results?: Array<Record<string, unknown>>;
};

async function fetchAllPages(
  startUrl: string,
  fetchImpl: typeof fetch,
): Promise<Array<Record<string, unknown>>> {
  const rows: Array<Record<string, unknown>> = [];
  let url: string | null = `${startUrl}${startUrl.includes('?') ? '&' : '?'}page=1`;
  let pages = 0;
  while (url) {
    const { body } = await fetchJson<UrbanPage>({ url, fetchImpl, timeoutMs: 120000 });
    const batch = body.results ?? [];
    rows.push(...batch);
    pages += 1;
    url = body.next ?? null;
    console.error(`[fetchCcd] page ${pages} +${batch.length} total=${rows.length}${url ? '' : ' done'}`);
    if (url) await sleepWithJitter(200, 150);
  }
  return rows;
}

export async function fetchCcdUniverse(options: {
  fixtures?: boolean;
  refresh?: boolean;
  fetchImpl?: typeof fetch;
}): Promise<{ path: string; rows: CcdDistrict[] }> {
  const fixtures = options.fixtures ?? false;
  const fixturePath = join(fixturesDir, 'ccd-universe.json');
  const livePath = join(ensureDir(dataDir), 'ccd-universe-2024.json');
  const outPath = fixtures ? fixturePath : livePath;

  if (!options.refresh && existsSync(outPath)) {
    const rows = loadJson<CcdDistrict[]>(outPath) ?? [];
    console.error(`[fetchCcd] cache hit ${rows.length} districts → ${outPath}`);
    return { path: outPath, rows };
  }

  if (fixtures) {
    throw new Error(`Fixture CCD universe missing: ${fixturePath}`);
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  console.error('[fetchCcd] downloading CCD directory 2024 (free, Urban Institute)');
  const directory = await fetchAllPages(DIRECTORY_URL, fetchImpl);
  console.error('[fetchCcd] downloading SAIPE 2024');
  const saipe = await fetchAllPages(SAIPE_URL, fetchImpl);
  console.error('[fetchCcd] downloading CCD directory 2021 for ELL/spec-ed (2024 fields are empty)');
  const ellFallback = await fetchAllPages(ELL_FALLBACK_URL, fetchImpl);
  const rows = attachEllSpec(
    joinSaipe(directory, saipe).map((row) => {
      if (row.poverty_share != null && row.poverty_share > 1) {
        return { ...row, poverty_share: row.poverty_share / 100 };
      }
      return row;
    }),
    ellFallback,
  );
  saveCcdUniverse(outPath, rows);
  writeJson(join(dataDir, 'ccd-fetch-summary.json'), {
    directory_rows: directory.length,
    saipe_rows: saipe.length,
    universe: rows.length,
    fetched_at: new Date().toISOString(),
  });
  console.error(`[fetchCcd] wrote ${rows.length} districts → ${outPath}`);
  return { path: outPath, rows };
}

async function main(): Promise<void> {
  loadEnv();
  const cli = parseCliArgs();
  await fetchCcdUniverse({
    fixtures: cli.fixtures || useFixtures(),
    refresh: cli.refresh,
  });
}

const isDirect = resolve(process.argv[1] ?? '') === resolve(packageRoot, 'src/fetchCcd.ts');
if (isDirect) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
