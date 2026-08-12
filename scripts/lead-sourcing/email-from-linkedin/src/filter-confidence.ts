import { mkdirSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCliArgs } from '../../webinar-hosts/src/lib/cli.js';
import { readCsv, writeCsv } from '../../webinar-hosts/src/lib/csv.js';
import { scoreEmailConfidence, type EmailConfidence } from './emailConfidence.js';
import { WITH_EMAIL_COLUMNS } from './types.js';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function resolvePath(path: string): string {
  return isAbsolute(path) ? path : resolve(process.cwd(), path);
}

type Row = Record<string, string>;

function main(): void {
  const options = parseCliArgs();
  const argv = process.argv.slice(2);
  const minArg = argv.find((a) => a.startsWith('--min='))?.slice('--min='.length);
  const minConfidence = (minArg === 'high' ? 'high' : 'mid') as EmailConfidence;

  if (!options.input) {
    throw new Error(
      'Usage: npm run filter-confidence -- --input <with_email.csv> [--run-dir <out>] [--min=mid|high]',
    );
  }

  const inputPath = resolvePath(options.input);
  const outDir = options.runDir
    ? isAbsolute(options.runDir)
      ? options.runDir
      : resolve(packageRoot, options.runDir)
    : resolve(dirname(inputPath));
  mkdirSync(outDir, { recursive: true });

  const rows = readCsv(inputPath);
  const kept: Row[] = [];
  const rejected: Row[] = [];

  for (const row of rows) {
    const scored = scoreEmailConfidence({
      email: row.email ?? '',
      company_domain: row.company_domain,
      company_name: row.company_name,
      match_method: row.match_method,
      title: row.title,
      reactor_headline: row.reactor_headline,
    });
    const out = {
      ...row,
      confidence: scored.confidence,
      confidence_reasons: scored.reasons.join('|'),
    };
    const pass =
      minConfidence === 'high'
        ? scored.confidence === 'high'
        : scored.confidence === 'high' || scored.confidence === 'mid';
    if (pass) kept.push(out);
    else rejected.push(out);
  }

  const keepCols = [...WITH_EMAIL_COLUMNS, 'confidence', 'confidence_reasons'] as string[];
  writeCsv(join(outDir, 'with_email_mid_high.csv'), kept, keepCols);
  writeCsv(join(outDir, 'with_email_low_confidence.csv'), rejected, keepCols);

  const high = kept.filter((r) => r.confidence === 'high').length;
  const mid = kept.filter((r) => r.confidence === 'mid').length;
  console.log(`Filtered ${rows.length} emails → keep ${kept.length} (high ${high}, mid ${mid}), reject ${rejected.length}`);
  console.log(`  min: ${minConfidence}`);
  console.log(`  kept: ${join(outDir, 'with_email_mid_high.csv')}`);
  console.log(`  rejected: ${join(outDir, 'with_email_low_confidence.csv')}`);
}

main();
