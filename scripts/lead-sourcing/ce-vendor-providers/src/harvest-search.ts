import { harvestSearch } from './search/harvest.js';
import { parseCliArgs } from './lib/cli.js';

const cli = parseCliArgs();
harvestSearch({ mode: cli.mode ?? 'host' }).catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
