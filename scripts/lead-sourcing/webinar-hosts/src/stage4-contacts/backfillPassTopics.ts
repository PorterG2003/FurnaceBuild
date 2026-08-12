/**
 * Backfill webinar_topic for pass-only lead CSVs via OpenRouter (post text → topic).
 *
 * Usage:
 *   npm run backfill-pass-topics -- [--concurrency 20] [--resume]
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CallCounter } from '../lib/callCounter.js';
import { readCsv, writeCsv } from '../lib/csv.js';
import { ensureEnv, packageRoot } from '../lib/env.js';
import { linkedInActivityId } from '../stage3-enrich/backfillSalesTopics.js';
import { analyzePostText } from '../stage3-enrich/postAnalyzer.js';

const SCOPE = resolve(packageRoot, 'output/runs/2026-07-29-aug13-scope');
const JUNE_S2 = resolve(
  packageRoot,
  'output/runs/2026-06-webinar-hosts/stage2_linkedin_webinar_posts_extracted.csv',
);
const JULY_S2 = resolve(
  packageRoot,
  'output/runs/2026-07-08-linkedin-webinar-posts/stage2_linkedin_webinar_posts_extracted.csv',
);

type Cli = { concurrency: number; resume: boolean; maxRows: number | null };

function parseCli(argv: string[]): Cli {
  const cli: Cli = { concurrency: 20, resume: false, maxRows: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--concurrency' && argv[i + 1]) cli.concurrency = Number(argv[++i]) || 20;
    else if (argv[i] === '--max-rows' && argv[i + 1]) cli.maxRows = Number(argv[++i]) || null;
    else if (argv[i] === '--resume') cli.resume = true;
  }
  return cli;
}

function loadPostText(): Map<string, string> {
  const map = new Map<string, string>();
  for (const path of [JUNE_S2, JULY_S2]) {
    for (const row of readCsv(path)) {
      const id = linkedInActivityId(row.result_url);
      const text = (row.post_text ?? '').trim();
      if (id && text && !map.has(id)) map.set(id, text);
    }
  }
  return map;
}

async function mapPool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
}

async function main(): Promise<void> {
  const cli = parseCli(process.argv.slice(2));
  await ensureEnv();
  mkdirSync(SCOPE, { recursive: true });

  const postText = loadPostText();
  const leadFiles = ['july_cold_pass.csv', 'june_retarget_pass.csv'];
  const needed = new Set<string>();
  for (const file of leadFiles) {
    for (const row of readCsv(join(SCOPE, file))) {
      if ((row.webinar_topic ?? '').trim()) continue;
      const id = row.activity_id || linkedInActivityId(row.sample_post_url) || '';
      if (id && postText.has(id)) needed.add(id);
    }
  }

  const cpPath = join(SCOPE, 'topic_backfill_checkpoint.json');
  let checkpoint: Record<string, string> = {};
  if (cli.resume && existsSync(cpPath)) {
    checkpoint = JSON.parse(readFileSync(cpPath, 'utf8')) as Record<string, string>;
  }

  let pending = [...needed].filter((id) => !(id in checkpoint));
  if (cli.maxRows != null) pending = pending.slice(0, cli.maxRows);
  console.log(`[backfill-pass-topics] needed=${needed.size} pending=${pending.length}`);

  const counter = new CallCounter();
  let done = 0;
  await mapPool(pending, cli.concurrency, async (activityId) => {
    const analysis = await analyzePostText(postText.get(activityId) ?? '', { counter });
    checkpoint[activityId] = (analysis.webinar_topic ?? '').trim();
    done += 1;
    if (done % 50 === 0 || done === pending.length) {
      writeFileSync(cpPath, JSON.stringify(checkpoint, null, 2));
      console.log(`[backfill-pass-topics] ${done}/${pending.length} openrouter=${counter.snapshot().openrouter_calls}`);
    }
  });
  writeFileSync(cpPath, JSON.stringify(checkpoint, null, 2));

  const leadCols = [
    'email',
    'first_name',
    'last_name',
    'company_name',
    'website',
    'sample_post_url',
    'contact_title',
    'contact_tier',
    'industry',
    'pool',
    'activity_id',
    'webinar_topic',
    'intent',
    'intent_pass',
    'intent_confidence',
    'intent_reason',
    'has_topic',
  ];

  for (const file of leadFiles) {
    const rows = readCsv(join(SCOPE, file)).map((row) => {
      const id = row.activity_id || linkedInActivityId(row.sample_post_url) || '';
      const existing = (row.webinar_topic ?? '').trim();
      const topic = existing || checkpoint[id] || '';
      return {
        ...row,
        webinar_topic: topic,
        has_topic: topic ? 'yes' : 'no',
      };
    });
    const outName = file.replace('_pass.csv', '_pass_with_topics.csv');
    writeCsv(join(SCOPE, outName), rows, leadCols);
    const withTopic = rows.filter((r) => r.has_topic === 'yes').length;
    console.log(`[backfill-pass-topics] ${outName}: ${withTopic}/${rows.length} with topic`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
