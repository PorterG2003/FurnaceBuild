/**
 * Record live API responses into fixtures/ for zero-cost pipeline tests.
 * Usage: SERPER_API_KEY=... APOLLO_API_KEY=... LINKEDIN_LI_AT=... npm run capture-fixtures
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEnv, fixturesDir } from './lib/env.js';
import { buildSerpQuery, loadQueriesConfig } from './lib/config.js';
import { serperSearch } from './stage1-serp/serperClient.js';
import { runStage2 } from './stage2-linkedin/extract.js';
import { enrichOrganization, searchPeopleByOrganization } from './stage3-enrich/apolloClient.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { writeCsvFromObjects } from './lib/csv.js';

async function main(): Promise<void> {
  loadEnv();
  mkdirSync(join(fixturesDir, 'serper'), { recursive: true });
  mkdirSync(join(fixturesDir, 'apollo'), { recursive: true });
  mkdirSync(join(fixturesDir, 'linkedin'), { recursive: true });

  const queries = loadQueriesConfig();
  const phrase = queries.phrases[0]!;
  const searchQuery = buildSerpQuery(phrase);

  const serperResponse = await serperSearch({
    query: searchQuery,
    page: 1,
    timeFilter: queries.time_filter,
    useFixtures: false,
  });
  writeFileSync(
    join(fixturesDir, 'serper/search-response.json'),
    `${JSON.stringify(serperResponse, null, 2)}\n`,
    'utf8',
  );

  const tempDir = mkdtempSync(join(tmpdir(), 'capture-fixtures-'));
  try {
    const organic = serperResponse.organic ?? [];
    const rows = organic
      .filter((item) => item.link?.includes('linkedin.com/posts/'))
      .slice(0, 3)
      .map((item, index) => ({
        result_url: item.link ?? '',
        result_title: item.title ?? '',
        result_snippet: item.snippet ?? '',
        search_query: searchQuery,
        serp_position: String(item.position ?? index + 1),
        serp_page: '1',
        collected_at: new Date().toISOString(),
        slug_hint: '',
        also_matched_queries: '',
      }));

    const stage1Path = join(tempDir, 'stage1.csv');
    writeCsvFromObjects(stage1Path, rows);

    await runStage2({
      inputPath: stage1Path,
      outputPath: join(tempDir, 'stage2.csv'),
      useFixtures: false,
      maxRows: 3,
    });

    const org = await enrichOrganization({ name: 'Acme Corp' }, { useFixtures: false });
    if (org) {
      writeFileSync(
        join(fixturesDir, 'apollo/org-enrich-acme-corp.json'),
        `${JSON.stringify({ organization: org }, null, 2)}\n`,
        'utf8',
      );

      if (org.id) {
        const { people } = await searchPeopleByOrganization(
          {
            organizationId: org.id,
            perPage: 2,
            matchLimit: 2,
            contactTiers: {
              tier1_webinar: ['marketing'],
              tier2_pipeline: ['sales'],
              tier2_seniority: ['director', 'vp', 'head of', 'chief'],
              tier3_executive: ['ceo', 'founder'],
              exclude: [],
            },
          },
          { useFixtures: false },
        );
        writeFileSync(
          join(fixturesDir, 'apollo', `people-search-${org.id}.json`),
          `${JSON.stringify({ people }, null, 2)}\n`,
          'utf8',
        );
      }
    }

    console.log(JSON.stringify({ captured: true, fixture_dir: fixturesDir }));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
