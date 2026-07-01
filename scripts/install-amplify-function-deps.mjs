#!/usr/bin/env node
/**
 * Installs npm dependencies for every Amplify Lambda under amplify/functions/* that
 * has a package.json. Skips launchSmartleadMigration when disabled via env flag.
 *
 * Run after root `npm ci` on Amplify backend preBuild.
 * Or: npm run install:amplify-function-deps
 */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const functionsDir = path.join(root, 'amplify', 'functions');

function smartleadMigrationEnabled() {
  const flag = (process.env.AMPLIFY_ENABLE_SMARTLEAD_MIGRATION ?? '').toLowerCase();
  return flag !== 'false' && flag !== '0';
}

function listFunctionDirsWithPackageJson() {
  if (!fs.existsSync(functionsDir)) {
    return [];
  }

  return fs
    .readdirSync(functionsDir, { withFileTypes: true })
    .filter((ent) => ent.isDirectory())
    .map((ent) => ent.name)
    .filter((name) => fs.existsSync(path.join(functionsDir, name, 'package.json')))
    .sort();
}

function installFunction(name) {
  const dir = path.join(functionsDir, name);
  console.log(`Installing ${name}...`);
  const result = spawnSync('npm', ['install'], {
    cwd: dir,
    stdio: 'inherit',
    env: process.env,
  });

  if (result.status !== 0) {
    console.error(`install-amplify-function-deps: FAILED for ${name}`);
    process.exit(result.status ?? 1);
  }
}

function main() {
  const names = listFunctionDirsWithPackageJson();
  const installed = [];

  for (const name of names) {
    if (name === 'launchSmartleadMigration' && !smartleadMigrationEnabled()) {
      console.log(
        'Skipping launchSmartleadMigration npm install (AMPLIFY_ENABLE_SMARTLEAD_MIGRATION disabled)',
      );
      continue;
    }
    installFunction(name);
    installed.push(name);
  }

  console.log(
    `install-amplify-function-deps: OK (${installed.length} function package(s): ${installed.join(', ')})`,
  );
}

main();
