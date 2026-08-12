import { resolve } from 'node:path';
import { ensureEnv, packageRoot, useFixtures } from '../lib/env.js';
import { readCsv, writeCsv } from '../lib/csv.js';
import { analyzePostText } from './postAnalyzer.js';

export const DEFAULT_STAGE2_PATH = resolve(
  packageRoot,
  'output/runs/2026-06-webinar-hosts/stage2_linkedin_webinar_posts_extracted.csv',
);

const ACTIVITY_ID_RE = /activity[:\-](\d+)/i;

export function linkedInActivityId(url: string | null | undefined): string | null {
  if (!url?.trim()) return null;
  const match = url.match(ACTIVITY_ID_RE);
  return match?.[1] ?? null;
}

export function withTopicsOutputPath(inputPath: string): string {
  if (inputPath.toLowerCase().endsWith('.csv')) {
    return `${inputPath.slice(0, -4)}-with-topics.csv`;
  }
  return `${inputPath}-with-topics.csv`;
}

export function buildPostTextByActivityId(
  stage2Rows: Array<Record<string, string>>,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of stage2Rows) {
    const activityId = linkedInActivityId(row.result_url);
    const postText = (row.post_text ?? '').trim();
    if (!activityId || !postText) continue;
    if (!map.has(activityId)) map.set(activityId, postText);
  }
  return map;
}

export type TopicMergeSummary = {
  rows: number;
  filled: number;
  skippedNoText: number;
  skippedEmptyTopic: number;
  errors: number;
};

export function applyTopicsToRows(
  rows: Array<Record<string, string>>,
  topicByActivityId: Map<string, string>,
): { rows: Array<Record<string, string>>; summary: TopicMergeSummary } {
  const summary: TopicMergeSummary = {
    rows: rows.length,
    filled: 0,
    skippedNoText: 0,
    skippedEmptyTopic: 0,
    errors: 0,
  };

  const out = rows.map((row) => {
    const activityId = linkedInActivityId(row.sample_post_url);
    if (!activityId || !topicByActivityId.has(activityId)) {
      summary.skippedNoText += 1;
      return { ...row, webinar_topic: row.webinar_topic ?? '' };
    }
    const topic = topicByActivityId.get(activityId) ?? '';
    if (!topic.trim()) {
      summary.skippedEmptyTopic += 1;
      return { ...row, webinar_topic: '' };
    }
    summary.filled += 1;
    return { ...row, webinar_topic: topic };
  });

  return { rows: out, summary };
}

export type BackfillSalesTopicsOptions = {
  inputPath: string;
  stage2Path?: string;
  outputPath?: string;
  maxRows?: number | null;
  useFixtures?: boolean;
  concurrency?: number;
  analyze?: typeof analyzePostText;
};

export type BackfillSalesTopicsResult = {
  inputPath: string;
  outputPath: string;
  stage2Path: string;
  uniquePosts: number;
  analyzed: number;
  summary: TopicMergeSummary;
};

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]!, index);
    }
  }

  const workers = Array.from({ length: Math.max(1, concurrency) }, () => worker());
  await Promise.all(workers);
  return results;
}

export async function backfillSalesTopics(
  options: BackfillSalesTopicsOptions,
): Promise<BackfillSalesTopicsResult> {
  const inputPath = resolve(options.inputPath);
  const stage2Path = resolve(options.stage2Path ?? DEFAULT_STAGE2_PATH);
  const outputPath = resolve(options.outputPath ?? withTopicsOutputPath(inputPath));
  const fixtures = options.useFixtures ?? useFixtures();
  const concurrency = options.concurrency ?? 5;
  const analyze = options.analyze ?? analyzePostText;

  let salesRows = readCsv(inputPath);
  if (options.maxRows != null && options.maxRows > 0) {
    salesRows = salesRows.slice(0, options.maxRows);
  }

  if (salesRows.length === 0) {
    throw new Error(`No rows found in ${inputPath}`);
  }

  const columns = Object.keys(salesRows[0]!);
  if (!columns.includes('webinar_topic')) {
    columns.push('webinar_topic');
  }
  if (!columns.includes('sample_post_url')) {
    throw new Error(`Input CSV is missing sample_post_url: ${inputPath}`);
  }

  const postTextByActivityId = buildPostTextByActivityId(readCsv(stage2Path));

  const uniqueActivityIds = [
    ...new Set(
      salesRows
        .map((row) => linkedInActivityId(row.sample_post_url))
        .filter((id): id is string => Boolean(id) && postTextByActivityId.has(id!)),
    ),
  ];

  const topicByActivityId = new Map<string, string>();
  let analyzed = 0;
  let errors = 0;

  await mapPool(uniqueActivityIds, concurrency, async (activityId, index) => {
    const postText = postTextByActivityId.get(activityId) ?? '';
    try {
      const analysis = await analyze(postText, {
        useFixtures: fixtures,
        enabled: true,
      });
      topicByActivityId.set(activityId, analysis.webinar_topic?.trim() ?? '');
      analyzed += 1;
    } catch (err) {
      errors += 1;
      topicByActivityId.set(activityId, '');
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[backfill-topics] error activity=${activityId}: ${message}`);
    }

    if ((index + 1) % 25 === 0 || index + 1 === uniqueActivityIds.length) {
      console.log(
        `[backfill-topics] analyzed ${index + 1}/${uniqueActivityIds.length} unique posts`,
      );
    }
  });

  const { rows: outRows, summary } = applyTopicsToRows(salesRows, topicByActivityId);
  summary.errors = errors;
  writeCsv(outputPath, outRows, columns);

  return {
    inputPath,
    outputPath,
    stage2Path,
    uniquePosts: uniqueActivityIds.length,
    analyzed,
    summary,
  };
}

function parseArgs(argv: string[]): {
  inputPath: string;
  stage2Path?: string;
  outputPath?: string;
  maxRows: number | null;
  fixtures: boolean;
} {
  let inputPath: string | undefined;
  let stage2Path: string | undefined;
  let outputPath: string | undefined;
  let maxRows: number | null = null;
  let fixtures = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--stage2' && argv[i + 1]) {
      stage2Path = argv[++i];
    } else if (arg === '--output' && argv[i + 1]) {
      outputPath = argv[++i];
    } else if (arg === '--max-rows' && argv[i + 1]) {
      maxRows = Number(argv[++i]) || null;
    } else if (arg === '--fixtures') {
      fixtures = true;
    } else if (!arg.startsWith('-') && !inputPath) {
      inputPath = arg;
    } else {
      throw new Error(`Unknown or incomplete argument: ${arg}`);
    }
  }

  if (!inputPath) {
    throw new Error(
      'Usage: npm run backfill-topics -- <sales-export.csv> [--stage2 <stage2.csv>] [--output <out.csv>] [--max-rows N] [--fixtures]',
    );
  }

  return { inputPath, stage2Path, outputPath, maxRows, fixtures };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  await ensureEnv();

  if (!args.fixtures && !process.env.OPENROUTER_API_KEY?.trim()) {
    console.error(
      'OPENROUTER_API_KEY could not be resolved from env or SSM. Set OPENROUTER_API_KEY or ensure DEV_SECRET_SSM_PREFIX / PROD_SECRET_SSM_PREFIX is available.',
    );
    process.exitCode = 1;
    return;
  }

  const result = await backfillSalesTopics({
    inputPath: args.inputPath,
    stage2Path: args.stage2Path,
    outputPath: args.outputPath,
    maxRows: args.maxRows,
    useFixtures: args.fixtures,
  });

  console.log(
    JSON.stringify(
      {
        input: result.inputPath,
        output: result.outputPath,
        stage2: result.stage2Path,
        unique_posts: result.uniquePosts,
        analyzed: result.analyzed,
        ...result.summary,
      },
      null,
      2,
    ),
  );
}

const isDirectRun =
  process.argv[1] != null &&
  (process.argv[1].endsWith('backfillSalesTopics.ts') ||
    process.argv[1].endsWith('backfillSalesTopics.js'));

if (isDirectRun) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
