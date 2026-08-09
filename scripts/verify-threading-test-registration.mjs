#!/usr/bin/env node
/**
 * Ensures every *Threading*.test.ts / *ThreadSubject*.test.ts file is listed in
 * the package.json test:threading* scripts (or an immediate dependency script).
 */
import { readFileSync, readdirSync, statSync, lstatSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

const SEARCH_ROOTS = ['lib', 'workers', 'scripts', 'amplify', 'app', 'components', 'hooks'];

const threadingScriptKeys = [
  'test:threading',
  'test:threading:unit',
  'test:threading:integration',
  'test:threading:browser',
  'test:threading:workers',
];

function collectScriptText(key, seen = new Set()) {
  if (seen.has(key)) return '';
  seen.add(key);
  const script = pkg.scripts?.[key];
  if (!script) return '';
  let out = script;
  const npmRun = script.matchAll(/npm run ([a-zA-Z0-9:_-]+)/g);
  for (const m of npmRun) {
    out += '\n' + collectScriptText(m[1], seen);
  }
  return out;
}

const registeredBlob = threadingScriptKeys.map((k) => collectScriptText(k)).join('\n');

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (
      entry === 'node_modules' ||
      entry === 'dist' ||
      entry === '.git' ||
      entry === 'web-build' ||
      entry === 'Pods' ||
      entry === 'build'
    ) {
      continue;
    }
    const full = join(dir, entry);
    let st;
    try {
      st = lstatSync(full);
    } catch {
      continue;
    }
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) {
      walk(full, out);
      continue;
    }
    if (
      entry.endsWith('.test.ts') &&
      (/Threading/i.test(entry) || /ThreadSubject/i.test(entry))
    ) {
      out.push(relative(root, full));
    }
  }
  return out;
}

const files = SEARCH_ROOTS.flatMap((dir) => walk(join(root, dir))).sort();
const missing = files.filter((f) => !registeredBlob.includes(f));

if (missing.length > 0) {
  console.error(
    'Threading test registration check failed.\n' +
      'These files match *Threading* / *ThreadSubject* but are not referenced by test:threading* scripts:\n' +
      missing.map((f) => `  - ${f}`).join('\n'),
  );
  process.exit(1);
}

console.log(
  `Threading test registration OK (${files.length} matching files covered by test:threading*).`,
);
