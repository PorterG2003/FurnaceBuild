import { join } from 'node:path';
import { parseCliArgs } from '../../webinar-hosts/src/lib/cli.js';
import { packageRoot } from './config.js';
import { prepFromProspects } from './prepFromProspects.js';

const cli = parseCliArgs();
const prospectsDefault = join(
  packageRoot,
  '../ce-vendor-providers/output/runs/pilot-ingest-1/prospects.csv',
);
const fitDefault = join(
  packageRoot,
  '../ce-vendor-providers/output/runs/pilot-ingest-1/fit_entries.csv',
);

const prospectsPath = cli.input ?? prospectsDefault;
const fitArg = process.argv.includes('--fit-entries')
  ? process.argv[process.argv.indexOf('--fit-entries') + 1]
  : undefined;
const fitEntriesPath = fitArg ?? fitDefault;
const runDir = cli.runDir ?? cli.resume ?? join(packageRoot, 'output/runs/ce-vendors-pilot-1');

const result = prepFromProspects({ prospectsPath, fitEntriesPath, runDir });

console.log(
  JSON.stringify(
    {
      run_dir: result.runDir,
      companies_path: result.companiesPath,
      platform_only_path: result.platformOnlyPath,
      with_domain: result.withDomain,
      platform_only: result.platformOnly,
      serper_full_ceiling: {
        queries: result.platformOnly,
        dollars: Number((result.platformOnly * 0.001).toFixed(3)),
      },
      serper_sample_40: {
        queries: Math.min(40, result.platformOnly),
        dollars: Number((Math.min(40, result.platformOnly) * 0.001).toFixed(3)),
      },
      note: 'Serper is paid. Dry-run discover-ce-domains before --live. Sample 40 first.',
    },
    null,
    2,
  ),
);
