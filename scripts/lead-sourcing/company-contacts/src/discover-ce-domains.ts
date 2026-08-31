import { join } from 'node:path';
import { parseCliArgs } from '../../webinar-hosts/src/lib/cli.js';
import { packageRoot } from './config.js';
import { discoverCeDomains } from './discoverCeDomains.js';

const argv = process.argv.slice(2);
const live = argv.includes('--live');
const cli = parseCliArgs(argv);
const runDir = cli.runDir ?? cli.resume ?? join(packageRoot, 'output/runs/ce-vendors-pilot-1');

discoverCeDomains({
  runDir,
  dryRun: cli.dryRun || !live,
  live,
  maxRows: cli.maxRows,
  fixtures: cli.fixtures,
})
  .then((result) => {
    if (!cli.dryRun && live) {
      console.log(JSON.stringify({ done: true, ...result }, null, 2));
    }
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
