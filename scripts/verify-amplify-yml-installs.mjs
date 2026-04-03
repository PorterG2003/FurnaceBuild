#!/usr/bin/env node
/**
 * 1) Ensures amplify.yml runs `npm install` in every Lambda package that:
 *    - is wired in amplify/backend.ts, or
 *    - uses a local `file:` dependency (covers future functions not yet in backend.ts).
 * 2) Any Lambda that depends on @furnace/registry-server (file: lib/foundry/registry-server) must
 *    also list @compwright/namecase directly (Lambda-local node_modules).
 * 3) Root package.json must list @compwright/namecase — Amplify runs esbuild from the repo root;
 *    resolution walks up from lib/foundry/registry-server/*.ts, so hoisted root node_modules is
 *    where the bundler finds the package after `npm ci`.
 *
 * Run: node scripts/verify-amplify-yml-installs.mjs
 * Or:  npm run verify:amplify-yml-installs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const ymlPath = path.join(root, 'amplify.yml');
const backendPath = path.join(root, 'amplify', 'backend.ts');
const functionsDir = path.join(root, 'amplify', 'functions');

function requiredInstallSnippet(name) {
  return `cd amplify/functions/${name} && npm install`;
}

function readBackendFunctionNames() {
  const src = fs.readFileSync(backendPath, 'utf8');
  const re = /\.\/functions\/([\w-]+)\/resource/g;
  const names = new Set();
  let m;
  while ((m = re.exec(src)) !== null) {
    names.add(m[1]);
  }
  return names;
}

function readFunctionDirsWithFileDeps() {
  const out = new Set();
  if (!fs.existsSync(functionsDir)) return out;
  for (const ent of fs.readdirSync(functionsDir, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const pkgPath = path.join(functionsDir, ent.name, 'package.json');
    if (!fs.existsSync(pkgPath)) continue;
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const hasFile = Object.values(deps).some((v) => typeof v === 'string' && v.startsWith('file:'));
    if (hasFile) out.add(ent.name);
  }
  return out;
}

function main() {
  const yml = fs.readFileSync(ymlPath, 'utf8');
  const fromBackend = readBackendFunctionNames();
  const fromFileDeps = readFunctionDirsWithFileDeps();
  const required = new Set([...fromBackend, ...fromFileDeps]);

  const errors = [];
  for (const name of required) {
    const needle = requiredInstallSnippet(name);
    if (!yml.includes(needle)) {
      errors.push(
        `Missing amplify.yml preBuild step: "${needle} && cd - || ..."\n` +
          `  (function: ${name}${fromFileDeps.has(name) ? ', uses file: dependency' : ''})`,
      );
    }
  }

  if (errors.length) {
    console.error('verify-amplify-yml-installs: FAILED\n');
    for (const e of errors) console.error(e + '\n');
    console.error(
      'Add the missing `cd amplify/functions/<name> && npm install` line(s) under backend.preBuild.commands.',
    );
    process.exit(1);
  }

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

  if (errors.length) {
    console.error('verify-amplify-yml-installs: FAILED\n');
    for (const e of errors) console.error(e + '\n');
    process.exit(1);
  }

  const rootPkgPath = path.join(root, 'package.json');
  const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf8'));
  if (!rootPkg.dependencies?.['@compwright/namecase']) {
    console.error(
      'verify-amplify-yml-installs: FAILED\n' +
        'Root package.json must include "@compwright/namecase" in dependencies (Amplify esbuild cwd is repo root; registry-server imports resolve via root node_modules after npm ci).\n',
    );
    process.exit(1);
  }

  console.log(
    `verify-amplify-yml-installs: OK (${required.size} function package(s) checked: ${[...required].sort().join(', ')})`,
  );
}

main();
