import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  actorIdForKind,
  createApifyClient,
  matchCountToTarget,
  runCountForUrls,
  type ApifyActorKind,
} from './apifyMetaAdsClient.js';
import { buildSearchTarget } from './apifyMetaAdsMap.js';
import { SANITY_CHECK_COMPANIES } from './pilotBatchRows.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(name);
}

function readFlag(argv: string[], name: string): string | null {
  const index = argv.indexOf(name);
  if (index < 0) return null;
  return argv[index + 1] ?? null;
}

async function runSanityForActor(kind: ApifyActorKind): Promise<{
  actor: ApifyActorKind;
  actorId: string;
  rows: Array<{
    domain: string;
    companyName: string;
    expected: string;
    domainCount: number;
    nameCount: number | null;
    pass: boolean;
  }>;
}> {
  const client = createApifyClient();
  const actorId = actorIdForKind(kind);
  const rows: Array<{
    domain: string;
    companyName: string;
    expected: string;
    domainCount: number;
    nameCount: number | null;
    pass: boolean;
  }> = [];

  for (const company of SANITY_CHECK_COMPANIES) {
    const domainTarget = buildSearchTarget(company.domain, company.domain, 'domain');
    const { counts: domainCounts } = await runCountForUrls(client, kind, [domainTarget.url]);
    const domainCount = matchCountToTarget(domainCounts, domainTarget)?.totalCount ?? 0;

    let nameCount: number | null = null;
    if (company.companyName.trim()) {
      const nameTarget = buildSearchTarget(company.domain, company.companyName, 'name');
      const { counts: nameCounts } = await runCountForUrls(client, kind, [nameTarget.url]);
      nameCount = matchCountToTarget(nameCounts, nameTarget)?.totalCount ?? 0;
    }

    const effectiveCount = Math.max(domainCount, nameCount ?? 0);
    const pass =
      company.expected === 'yes' ? effectiveCount > 0 : effectiveCount === 0;

    rows.push({
      domain: company.domain,
      companyName: company.companyName,
      expected: company.expected,
      domainCount,
      nameCount,
      pass,
    });

    process.stderr.write(
      `[sanity:${kind}] ${company.domain} expected=${company.expected} domain=${domainCount} name=${nameCount ?? 'n/a'} ${pass ? 'ok' : 'FAIL'}\n`,
    );
  }

  return { actor: kind, actorId, rows };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const leadsbraryOnly = hasFlag(argv, '--leadsbrary-only');
  const officialOnly = hasFlag(argv, '--official-only');

  const actors: ApifyActorKind[] = [];
  if (officialOnly) actors.push('official');
  else if (leadsbraryOnly) actors.push('leadsbrary');
  else actors.push('leadsbrary', 'official');

  const results = [];
  for (const kind of actors) {
    process.stderr.write(`\n[sanity] Running ${actorIdForKind(kind)}...\n`);
    results.push(await runSanityForActor(kind));
  }

  const leadsbrary = results.find((result) => result.actor === 'leadsbrary');
  const nike = leadsbrary?.rows.find((row) => row.domain === 'nike.com');
  const supermetrics = leadsbrary?.rows.find((row) => row.domain === 'supermetrics.com');
  const gatePass =
    !leadsbrary ||
    (((nike?.domainCount ?? 0) > 0 || (nike?.nameCount ?? 0) > 0) &&
      ((supermetrics?.domainCount ?? 0) > 0 || (supermetrics?.nameCount ?? 0) > 0));

  const summary = {
    gate: {
      leadsbrary_nike_or_supermetrics_has_ads: gatePass,
      recommendation: gatePass
        ? 'Proceed with Leadsbrary 150-company pilot'
        : 'Abort pilot — Leadsbrary returned 0 for nike.com and supermetrics.com; try official actor or retry later',
    },
    results,
  };

  console.log(JSON.stringify(summary, null, 2));
  if (!gatePass && leadsbrary) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
