/**
 * Generate short topic_hook phrases for unique webinar topics (OpenRouter).
 *
 * Usage:
 *   npm run generate-topic-hooks -- --max-rows 30
 *   npm run generate-topic-hooks -- --resume
 *   npm run generate-topic-hooks -- --refetch-invalid   # re-gen checkpoint hooks that fail validation
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CallCounter } from '../lib/callCounter.js';
import { ensureEnv } from '../lib/env.js';
import { generateTopicHook, isValidTopicHook } from './topicHookLlm.js';
import { roleLineFromTier } from './personalizationFields.js';

const SCOPE = join(
  process.cwd(),
  'output/runs/2026-07-29-aug13-scope',
);

type Cli = {
  concurrency: number;
  resume: boolean;
  maxRows: number | null;
  refetchInvalid: boolean;
};

function parseCli(argv: string[]): Cli {
  const cli: Cli = { concurrency: 20, resume: false, maxRows: null, refetchInvalid: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--resume') cli.resume = true;
    else if (a === '--refetch-invalid') cli.refetchInvalid = true;
    else if (a === '--concurrency' && argv[i + 1]) cli.concurrency = Number(argv[++i]) || 20;
    else if (a === '--max-rows' && argv[i + 1]) cli.maxRows = Number(argv[++i]) || null;
  }
  return cli;
}

function readCsv(path: string): Record<string, string>[] {
  const text = readFileSync(path, 'utf8');
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]!);
  return lines.slice(1).map((line) => {
    const cols = parseCsvLine(line);
    const row: Record<string, string> = {};
    for (let i = 0; i < headers.length; i++) row[headers[i]!] = cols[i] ?? '';
    return row;
  });
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQ = false;
      } else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function escapeCsv(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function writeCsv(path: string, rows: Record<string, string>[], headers: string[]): void {
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => escapeCsv(row[h] ?? '')).join(','));
  }
  writeFileSync(path, lines.join('\n') + '\n');
}

async function mapPool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  const worker = async () => {
    for (;;) {
      const idx = i++;
      if (idx >= items.length) return;
      await fn(items[idx]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
}

async function main(): Promise<void> {
  await ensureEnv();
  const cli = parseCli(process.argv.slice(2));
  mkdirSync(SCOPE, { recursive: true });

  const coldPath = join(SCOPE, 'campaign-import/furnace_import_aug13_cold_verified.csv');
  const warmPath = join(SCOPE, 'campaign-import/furnace_import_aug13_retarget_verified.csv');
  const cold = existsSync(coldPath) ? readCsv(coldPath) : [];
  const warm = existsSync(warmPath) ? readCsv(warmPath) : [];

  const topicSet = new Set<string>();
  for (const row of [...cold, ...warm]) {
    const t = (row.webinar_topic || '').trim();
    if (t) topicSet.add(t);
  }
  let topics = [...topicSet].sort();
  if (cli.maxRows != null) topics = topics.slice(0, cli.maxRows);

  const checkpointPath = join(SCOPE, 'topic_hooks_checkpoint.json');
  let checkpoint: Record<string, string> = {};
  if ((cli.resume || cli.refetchInvalid) && existsSync(checkpointPath)) {
    checkpoint = JSON.parse(readFileSync(checkpointPath, 'utf8')) as Record<string, string>;
  }

  if (cli.refetchInvalid) {
    let cleared = 0;
    for (const topic of topics) {
      const existing = checkpoint[topic];
      if (existing != null && !isValidTopicHook(existing)) {
        delete checkpoint[topic];
        cleared += 1;
      }
    }
    console.log(`[topic-hooks] refetch-invalid cleared=${cleared} checkpoint keys`);
  }

  const pending = topics.filter((t) => !checkpoint[t]);
  const counter = new CallCounter();
  console.log(
    `[topic-hooks] unique=${topics.length} pending=${pending.length} concurrency=${cli.concurrency}`,
  );

  let done = 0;
  await mapPool(pending, cli.concurrency, async (topic) => {
    const hook = await generateTopicHook(topic, { counter });
    checkpoint[topic] = hook;
    done += 1;
    if (done % 25 === 0 || done === pending.length) {
      writeFileSync(checkpointPath, JSON.stringify(checkpoint, null, 2));
      console.log(
        `[topic-hooks] ${done}/${pending.length} openrouter=${counter.snapshot().openrouter_calls}`,
      );
    }
  });
  writeFileSync(checkpointPath, JSON.stringify(checkpoint, null, 2));

  const qaPath = join(SCOPE, cli.maxRows ? 'topic_hooks_qa.csv' : 'topic_hooks.csv');
  writeCsv(
    qaPath,
    topics.map((t) => ({ webinar_topic: t, topic_hook: checkpoint[t] || 'your next webinar' })),
    ['webinar_topic', 'topic_hook'],
  );

  // Attach to LI import CSVs only on full run (not partial QA)
  if (cli.maxRows == null) {
    const enrich = (rows: Record<string, string>[], outName: string) => {
      const out = rows.map((r) => {
        const topic = (r.webinar_topic || '').trim();
        const hook = (topic && checkpoint[topic]) || 'your next webinar';
        return {
          ...r,
          topic_hook: hook,
          role_line: roleLineFromTier(r.contact_tier),
        };
      });
      const headers = [...new Set([...Object.keys(out[0] || {}), 'topic_hook', 'role_line'])];
      writeCsv(join(SCOPE, 'campaign-import', outName), out, headers);
      const withHook = out.filter((r) => (r.topic_hook || '').trim() && r.topic_hook !== 'your next webinar').length;
      console.log(`[topic-hooks] wrote ${outName}: ${withHook}/${out.length} non-fallback topic_hook`);
    };
    enrich(cold, 'furnace_import_aug13_cold_personalized.csv');
    enrich(warm, 'furnace_import_aug13_retarget_personalized.csv');
  }

  console.log(`[topic-hooks] done openrouter=${counter.snapshot().openrouter_calls} → ${qaPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
