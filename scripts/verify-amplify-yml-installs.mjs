#!/usr/bin/env node
/**
 * Static bundling checks for Amplify Lambda packages (no npm install required).
 *
 * 1) Any Lambda that depends on @furnace/registry-server (file: lib/foundry/registry-server) must
 *    also list @compwright/namecase directly (Lambda-local node_modules).
 * 2) Root package.json must list @compwright/namecase — Amplify runs esbuild from the repo root;
 *    resolution walks up from lib/foundry/registry-server/*.ts, so hoisted root node_modules is
 *    where the bundler finds the package after `npm ci`.
 *
 * Function deps are installed automatically by scripts/install-amplify-function-deps.mjs.
 *
 * Run: node scripts/verify-amplify-yml-installs.mjs
 * Or:  npm run verify:amplify-yml-installs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const functionsDir = path.join(root, 'amplify', 'functions');

function main() {
  const errors = [];

  // Amplify esbuild bundles from the function folder; deps only under file:linked @furnace/registry-server
  // are not always resolved on CI. Mirror registry-server runtime deps here when applicable.
  const registryPath = 'lib/foundry/registry-server';
  for (const ent of fs.readdirSync(functionsDir, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const pkgPath = path.join(functionsDir, ent.name, 'package.json');
    if (!fs.existsSync(pkgPath)) continue;
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const rs = pkg.dependencies?.['@furnace/registry-server'];
    if (typeof rs !== 'string' || !rs.includes(registryPath)) continue;
    if (!pkg.dependencies?.['@compwright/namecase']) {
      errors.push(
        `${ent.name}/package.json: depends on @furnace/registry-server but missing direct dependency "@compwright/namecase" (required for Amplify Lambda bundling).`,
      );
    }
  }

  const rootPkgPath = path.join(root, 'package.json');
  const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf8'));
  if (!rootPkg.dependencies?.['@compwright/namecase']) {
    errors.push(
      'Root package.json must include "@compwright/namecase" in dependencies (Amplify esbuild cwd is repo root; registry-server imports resolve via root node_modules after npm ci).',
    );
  }

  if (errors.length) {
    console.error('verify-amplify-yml-installs: FAILED\n');
    for (const e of errors) console.error(e + '\n');
    process.exit(1);
  }

  console.log('verify-amplify-yml-installs: OK (bundling rules)');
}

main();
