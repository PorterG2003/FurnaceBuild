import { join } from 'node:path';
import { readdirSync } from 'node:fs';
import { createRunDir, parseCliArgs } from '../../webinar-hosts/src/lib/cli.js';
import { packageRoot } from './config.js';
import { prepCompanies } from './prepCompanies.js';

function parseInputs(argv: string[]): string[] {
  const inputs: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--input' && argv[i + 1]) {
      inputs.push(argv[++i]!);
    }
  }
  return inputs;
}

const argv = process.argv.slice(2);
const cli = parseCliArgs(argv);
const inputs = parseInputs(argv);
if (inputs.length === 0 && !cli.input) {
  console.error(
    'Usage: npm run prep-companies -- --input path/a.csv [--input path/b.csv] [--run-dir output/runs/...]',
  );
  process.exit(1);
}
const inputPaths = inputs.length > 0 ? inputs : [cli.input!];
const runDir = cli.runDir ?? cli.resume ?? join(packageRoot, createRunDir());

const result = prepCompanies({
  inputPaths,
  runDir,
  maxRows: cli.maxRows,
});

console.log(
  JSON.stringify(
    {
      run_dir: result.runDir,
      companies_path: result.companiesPath,
      company_count: result.companies.length,
      sources: readdirSync(join(result.runDir, 'sources')),
    },
    null,
    2,
  ),
);
