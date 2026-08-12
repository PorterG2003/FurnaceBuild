import { join } from 'node:path';
import { prepPass3 } from './pass3Prep.js';
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

  const result = prepPass3({
    pass1Dir,
    pass2Dir: join(pass1Dir, 'pass2'),
    pass3Dir,
  });
  console.log(
    JSON.stringify({ dry_run_prep_pass3: true, pass3Dir: result.pass3Dir, counts: result.counts }, null, 2),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
