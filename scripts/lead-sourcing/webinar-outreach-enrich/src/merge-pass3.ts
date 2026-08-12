import { join } from 'node:path';
import { mergePass3 } from './mergePass3.js';
import { outputDir, parseArgs } from './env.js';

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const pass1Dir =
    typeof args['pass1-dir'] === 'string'
      ? args['pass1-dir']
      : join(outputDir, 'runs', 'pass1');
  const pass3Dir =
    typeof args['pass3-dir'] === 'string'
      ? args['pass3-dir']
      : join(pass1Dir, 'pass3');
  mergePass3({ pass1Dir, pass3Dir });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
