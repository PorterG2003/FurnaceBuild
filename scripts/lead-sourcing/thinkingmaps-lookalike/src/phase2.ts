import { parseCliArgs, requireLiveForPaid } from './lib/cli.js';
import { loadEnv } from './lib/env.js';

/**
 * Phase 2 is spend-gated. Domain resolution (Serper) and contact find
 * (Apollo) are not run from this package until the ranked district list
 * is approved and the user names vendor + scale.
 */
export function phase2Message(): string {
  return [
    'Phase 2 (district domains via Serper, then Apollo contacts) is gated.',
    'Nothing in this command calls a metered vendor.',
    'After the ranked lookalike list is approved, estimate Serper lookups',
    'for the top N districts and Apollo people-search credits, then ask for',
    'explicit spend OK before --live.',
  ].join(' ');
}

async function main(): Promise<void> {
  loadEnv();
  const cli = parseCliArgs();
  console.error(phase2Message());
  requireLiveForPaid({
    live: cli.live,
    dryRun: cli.dryRun,
    fixtures: cli.fixtures,
    vendor: 'Serper/Apollo',
  });
  throw new Error('Phase 2 is not implemented in this package. Reuse thinkingmaps-avoid-domains resolve + company-contacts after spend OK.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
