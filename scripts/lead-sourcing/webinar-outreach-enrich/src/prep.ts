import { join } from 'node:path';
import { prepCohorts } from './cohortPrep.js';
import { defaultOutreachCsv, outputDir, parseArgs } from './env.js';

function resolvePath(path: string): string {
  return path.startsWith('/') ? path : join(process.cwd(), path);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const inputCsv =
    typeof args.input === 'string' ? resolvePath(args.input) : defaultOutreachCsv();
  const runId =
    typeof args['run-id'] === 'string'
      ? args['run-id']
      : new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const runDir = join(outputDir, 'runs', runId);

  const result = prepCohorts({ inputCsv, runDir });
  console.log(
    JSON.stringify({ dry_run_prep: true, runDir: result.runDir, ...result.estimates }, null, 2),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
