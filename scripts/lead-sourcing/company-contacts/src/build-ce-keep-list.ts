import { join } from 'node:path';
import { parseCliArgs } from '../../webinar-hosts/src/lib/cli.js';
import { packageRoot } from './config.js';
import { writeCeKeepList } from './ceKeepList.js';

const cli = parseCliArgs();
const runDir = cli.runDir ?? cli.resume ?? join(packageRoot, 'output/runs/ce-vendors-pilot-1');
const result = writeCeKeepList({ runDir });
console.log(JSON.stringify({ done: true, ...result }, null, 2));
