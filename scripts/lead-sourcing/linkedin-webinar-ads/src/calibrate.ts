import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { loadSelfRecoveryEnv, resolveOpenRouterApiKey } from '../../../self-recovery-env.js';
import { ensureRunDir, writeJson, writeText } from './io.js';
import type { RawAd, ReviewDecision } from './types.js';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'google/gemini-2.5-flash-lite';
const BATCH_SIZE = 20;

type CalibrationExample = {
  id: string;
  decision: ReviewDecision['decision'];
  note: string;
  advertiser: string;
  copy: string;
  landingUrl: string;
};

type Options = {
  runDirs: string[];
  outDir: string;
  maxCalls: number;
  live: boolean;
  model: string;
};

function parseArgs(argv = process.argv.slice(2)): Options {
  const options: Options = {
    runDirs: [],
    outDir: `output/calibration/${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}`,
    maxCalls: 6,
    live: false,
    model: DEFAULT_MODEL,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--run-dir' && argv[index + 1]) options.runDirs.push(argv[++index]!);
    else if (arg === '--out-dir' && argv[index + 1]) options.outDir = argv[++index]!;
    else if (arg === '--max-calls' && argv[index + 1]) options.maxCalls = Number(argv[++index]);
    else if (arg === '--model' && argv[index + 1]) options.model = argv[++index]!;
    else if (arg === '--live') options.live = true;
  }
  if (options.runDirs.length === 0) throw new Error('Provide at least one --run-dir');
  if (!Number.isInteger(options.maxCalls) || options.maxCalls < 2) throw new Error('--max-calls must be at least 2');
  return options;
}

function rawKey(ad: RawAd): string {
  if (ad.adId) return `id:${ad.adId}`;
  return `fp:${createHash('sha256').update(`${ad.advertiserName}|${ad.primaryText}|${ad.landingUrl}`).digest('hex').slice(0, 16)}`;
}

function loadExamples(runDir: string): CalibrationExample[] {
  const checkpoint = JSON.parse(readFileSync(join(runDir, 'checkpoint.json'), 'utf8')) as { rawAds: RawAd[] };
  const decisionsPath = join(runDir, 'review-decisions.applied.json');
  if (!existsSync(decisionsPath)) throw new Error(`No applied decisions found in ${runDir}`);
  const decisionFile = JSON.parse(readFileSync(decisionsPath, 'utf8')) as { decisions: ReviewDecision[] };
  const rawByKey = new Map(checkpoint.rawAds.map((ad) => [rawKey(ad), ad]));
  return decisionFile.decisions.flatMap((decision) => {
    const ad = rawByKey.get(decision.dedupeKey);
    if (!ad) return [];
    return [{
      id: decision.dedupeKey,
      decision: decision.decision,
      note: decision.note ?? '',
      advertiser: ad.advertiserName ?? '',
      copy: (ad.primaryText ?? '').slice(0, 1_400),
      landingUrl: ad.landingUrl ?? '',
    }];
  });
}

async function callModel(apiKey: string, model: string, system: string, user: string): Promise<string> {
  const response = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      response_format: { type: 'json_object' },
      max_tokens: 2_000,
    }),
  });
  const body = await response.json().catch(() => ({})) as { choices?: Array<{ message?: { content?: string } }>; error?: unknown };
  const text = body.choices?.[0]?.message?.content;
  if (!response.ok || !text) throw new Error(`OpenRouter calibration failed: ${JSON.stringify(body.error ?? body).slice(0, 500)}`);
  return text;
}

function markdownReport(synthesis: string, examples: CalibrationExample[], calls: number): string {
  return `# LinkedIn webinar-ad calibration\n\n- Model calls: ${calls}\n- Labeled examples: ${examples.length}\n- Model: ${DEFAULT_MODEL}\n\n## Synthesis\n\n\`\`\`json\n${synthesis}\n\`\`\`\n`;
}

async function main(): Promise<void> {
  const options = parseArgs();
  const root = process.env.INIT_CWD ?? process.cwd();
  loadEnv({ path: resolve(root, '.env') });
  loadSelfRecoveryEnv();
  const outDir = ensureRunDir(resolve(root, options.outDir));
  const examplesById = new Map<string, CalibrationExample>();
  for (const dir of options.runDirs) {
    for (const example of loadExamples(resolve(root, dir))) examplesById.set(example.id, example);
  }
  const examples = [...examplesById.values()];
  const batches = Array.from({ length: Math.ceil(examples.length / BATCH_SIZE) }, (_, index) =>
    examples.slice(index * BATCH_SIZE, (index + 1) * BATCH_SIZE),
  );
  const expectedCalls = batches.length + 1;
  if (expectedCalls > options.maxCalls) {
    throw new Error(`Calibration needs ${expectedCalls} calls for ${examples.length} examples; cap is ${options.maxCalls}.`);
  }
  writeJson(join(outDir, 'calibration_manifest.json'), {
    model: options.model,
    labeled_examples: examples.length,
    planned_calls: expectedCalls,
    source_run_dirs: options.runDirs,
    live: options.live,
  });
  if (!options.live) {
    console.log(JSON.stringify({ dry_run: true, examples: examples.length, planned_calls: expectedCalls, out_dir: outDir }));
    return;
  }

  const { apiKey, source: apiKeySource } = await resolveOpenRouterApiKey();
  console.log(`[calibration] OpenRouter credential resolved from ${apiKeySource}`);
  const system = [
    'You are calibrating a deterministic classifier for LinkedIn ads promoting live B2B webinars/events.',
    'Human labels are ground truth: keep means likely pipeline-generating B2B event, exclude means not useful, review means insufficient context.',
    'Identify observable copy signals only. Do not invent company facts. Return JSON only.',
  ].join(' ');
  const batchAnalyses: string[] = [];
  for (const [index, batch] of batches.entries()) {
    const result = await callModel(
      apiKey,
      options.model,
      system,
      JSON.stringify({
        task: 'Extract concise keep/exclude/review decision patterns and candidate deterministic regex concepts from these human-labeled examples.',
        examples: batch,
      }),
    );
    batchAnalyses.push(result);
    writeText(join(outDir, `batch-${index + 1}.json`), result);
  }
  const synthesis = await callModel(
    apiKey,
    options.model,
    system,
    JSON.stringify({
      task: 'Synthesize rule changes. Return JSON with keys: qualification_signals, exclusion_signals, review_signals, regression_cases. Prefer high-precision rules and explicitly list ambiguity that should remain review.',
      batch_analyses: batchAnalyses,
    }),
  );
  writeText(join(outDir, 'synthesis.json'), synthesis);
  writeText(join(outDir, 'calibration-report.md'), markdownReport(synthesis, examples, expectedCalls));
  console.log(JSON.stringify({ completed: true, examples: examples.length, calls: expectedCalls, out_dir: outDir }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
