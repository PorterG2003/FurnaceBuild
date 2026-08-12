import { join } from 'node:path';
import { prepPass2 } from './pass2Prep.js';
import { outputDir, parseArgs } from './env.js';

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const pass1Dir =
    typeof args['pass1-dir'] === 'string'
      ? args['pass1-dir']
      : join(outputDir, 'runs', 'pass1');
  const pass2Dir =
    typeof args['pass2-dir'] === 'string'
      ? args['pass2-dir']
      : join(pass1Dir, 'pass2');

  const result = prepPass2({ pass1Dir, pass2Dir });
  console.log(
    JSON.stringify(
      {
        dry_run_prep_pass2: true,
        pass2Dir: result.pass2Dir,
        counts: result.counts,
        estimates: result.estimates,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
