import { runGoogleAdsTransparencyLookup } from './transparencyLookup.js';

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
      'Usage: node --import tsx workers/state-scrapers/google-ads-verification-worker/src/local.ts --domain <domain> [--headless] [--region US] [--output-dir tmp/google-ads]',
    );
  }

  const result = await runGoogleAdsTransparencyLookup({
    domain,
    region: readFlag('--region') ?? 'US',
    headless: hasFlag('--headless'),
    slowMoMs: Number(readFlag('--slow-mo-ms') ?? 150),
    timeoutMs: Number(readFlag('--timeout-ms') ?? 20_000),
    outputDir: readFlag('--output-dir'),
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
