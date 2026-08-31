import { join } from 'node:path';
import { parseCliArgs } from '../../webinar-hosts/src/lib/cli.js';
import { packageRoot } from './config.js';
import { enrichProspeoMisses } from './prospeoMisses.js';

const argv = process.argv.slice(2);
const live = argv.includes('--live');
const maxCreditsIdx = argv.indexOf('--max-prospeo-credits');
const maxProspeoCredits =
  maxCreditsIdx >= 0 && argv[maxCreditsIdx + 1] ? Number(argv[maxCreditsIdx + 1]) : null;
const cli = parseCliArgs(argv);
const runDir = cli.runDir ?? cli.resume ?? join(packageRoot, 'output/runs/ce-vendors-pilot-1');

enrichProspeoMisses({
  runDir,
  dryRun: cli.dryRun || !live,
  live,
  maxRows: cli.maxRows,
  maxProspeoCredits: Number.isFinite(maxProspeoCredits) ? maxProspeoCredits : 40,
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
