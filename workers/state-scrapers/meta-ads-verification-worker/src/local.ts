import { runMetaAdLibraryLookup } from './metaAdLibraryLookup.js';

function readFlag(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  return process.argv[index + 1] ?? null;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

async function main(): Promise<void> {
  const domain = readFlag('--domain') ?? process.argv[2] ?? '';
  if (!domain.trim()) {
    throw new Error(
      'Usage: node --import tsx workers/state-scrapers/meta-ads-verification-worker/src/local.ts --domain <domain> [--company-name <name>] [--headless] [--country US] [--output-dir tmp/meta-ads] [--scan-webinars] [--webinar-days 30]',
    );
  }

  const result = await runMetaAdLibraryLookup({
    domain,
    companyName: readFlag('--company-name'),
    country: readFlag('--country') ?? 'US',
    headless: hasFlag('--headless'),
    slowMoMs: Number(readFlag('--slow-mo-ms') ?? 150),
    timeoutMs: Number(readFlag('--timeout-ms') ?? 20_000),
    outputDir: readFlag('--output-dir'),
    scanWebinars: hasFlag('--scan-webinars'),
    webinarScanDays: Number(readFlag('--webinar-days') ?? 30),
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
