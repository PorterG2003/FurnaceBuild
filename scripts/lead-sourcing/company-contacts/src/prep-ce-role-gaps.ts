import { join } from 'node:path';
import { parseCliArgs } from '../../webinar-hosts/src/lib/cli.js';
import { packageRoot } from './config.js';
import { writeCeRoleGapRun } from './ceKeepList.js';

const cli = parseCliArgs();
const sourceRunDir =
  cli.input ?? join(packageRoot, 'output/runs/ce-vendors-pilot-1');
const destRunDir =
  cli.runDir ?? cli.resume ?? join(packageRoot, 'output/runs/ce-vendors-roles-2');
const result = writeCeRoleGapRun({ sourceRunDir, destRunDir });
console.log(JSON.stringify({ done: true, ...result }, null, 2));
