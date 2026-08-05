#!/usr/bin/env node
/**
 * Dev ECS worker lease CLI — hard-coded to dev account/cluster only.
 * Invoked via lease-dev.sh (tsx) or npm run lease:dev*.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const cliTs = path.join(scriptDir, 'lease-dev-cli.ts');

function resolveTsx() {
  const local = path.join(scriptDir, '..', 'node_modules', '.bin', 'tsx');
  if (existsSync(local)) {
    return local;
  }
  return 'tsx';
}

const tsx = resolveTsx();
const result = spawnSync(tsx, [cliTs, ...process.argv.slice(2)], {
  stdio: 'inherit',
  cwd: path.join(scriptDir, '..'),
  env: process.env,
});

if (result.error) {
  console.error(`Failed to run lease CLI: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
