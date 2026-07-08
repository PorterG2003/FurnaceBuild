#!/usr/bin/env node
/**
 * Next.js basePath=/docs exports HTML under out/docs/, but CloudFront strips the
 * /docs prefix before S3 lookup. Hoist out/docs/* to out/ so /docs/guides/foo/
 * resolves to guides/foo/index.html in the bucket.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, '..', 'out');
const docsDir = path.join(outDir, 'docs');

function mergeDirectory(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      mergeDirectory(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function main() {
  if (!fs.existsSync(docsDir)) {
    console.log('[flatten-docs-export] no out/docs directory — skipping');
    return;
  }

  for (const name of fs.readdirSync(docsDir)) {
    const src = path.join(docsDir, name);
    const dest = path.join(outDir, name);
    if (fs.existsSync(dest)) {
      if (fs.statSync(src).isDirectory()) {
        mergeDirectory(src, dest);
      } else {
        fs.copyFileSync(src, dest);
      }
      fs.rmSync(src, { recursive: true, force: true });
    } else {
      fs.renameSync(src, dest);
    }
  }

  fs.rmSync(docsDir, { recursive: true, force: true });
  console.log('[flatten-docs-export] hoisted out/docs/* to out/ for CloudFront');
}

main();
