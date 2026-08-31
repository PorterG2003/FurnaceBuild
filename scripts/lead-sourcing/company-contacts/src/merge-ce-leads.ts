import { join } from 'node:path';
import { parseCliArgs } from '../../webinar-hosts/src/lib/cli.js';
import { packageRoot } from './config.js';
import { writeCeCombinedLeads } from './ceKeepList.js';

const cli = parseCliArgs();
const keepPath =
  cli.input ?? join(packageRoot, 'output/runs/ce-vendors-pilot-1/leads_ce_icp.csv');
const gapRunDir = cli.runDir ?? join(packageRoot, 'output/runs/ce-vendors-roles-2');
const gapPath = join(gapRunDir, 'leads.csv');
const outPath = cli.output ?? join(gapRunDir, 'leads_combined.csv');
const result = writeCeCombinedLeads({ keepPath, gapPath, outPath });
console.log(JSON.stringify({ done: true, ...result }, null, 2));
