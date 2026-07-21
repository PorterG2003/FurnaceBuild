import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  countPostCliffEmptyNoResults,
  DEFAULT_CLIFF_WINDOW,
  DEFAULT_ROLLING_WINDOW,
  detectCliffIndex,
  findKnownAdvertiserFalseNegatives,
  orderResultsByCompletion,
  summarizeWindow,
} from './apifyBatchHealth.js';
import { loadApifyCheckpoint } from './metaAdLibraryApifyCheckpoint.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT_DIR =
  '../../../../scripts/lead-sourcing/webinar-hosts/output/runs/2026-07-15-meta-ads-webinar-hosts';

function readFlag(argv: string[], name: string): string | null {
  const index = argv.indexOf(name);
  if (index < 0) return null;
  return argv[index + 1] ?? null;
}

function main(): void {
  const argv = process.argv.slice(2);
  const outDir = resolve(__dirname, readFlag(argv, '--out-dir') ?? DEFAULT_OUT_DIR);
  const checkpointPath = resolve(outDir, readFlag(argv, '--checkpoint') ?? 'apify-batch-checkpoint.json');
  const windowSize = Number(readFlag(argv, '--window') ?? DEFAULT_ROLLING_WINDOW);
  const cliffWindow = Number(readFlag(argv, '--cliff-window') ?? DEFAULT_CLIFF_WINDOW);

  const checkpoint = loadApifyCheckpoint(checkpointPath);
  if (!checkpoint) throw new Error(`No checkpoint found at ${checkpointPath}`);

  const ordered = orderResultsByCompletion(checkpoint.completedDomains, checkpoint.results);
  const buckets: ReturnType<typeof summarizeWindow>[] = [];
  for (let i = 0; i < ordered.length; i += windowSize) {
    buckets.push(summarizeWindow(ordered, i, Math.min(i + windowSize, ordered.length)));
  }

  const cliffIndex = detectCliffIndex(ordered, cliffWindow);
  const invalidateCount =
    cliffIndex == null ? 0 : countPostCliffEmptyNoResults(ordered, cliffIndex);
  const falseNegatives = findKnownAdvertiserFalseNegatives(ordered);

  const report = {
    checkpoint: checkpointPath,
    completed: ordered.length,
    cliff_index_0based: cliffIndex,
    cliff_index_1based: cliffIndex == null ? null : cliffIndex + 1,
    cliff_window: cliffWindow,
    recommended_invalidate_count: invalidateCount,
    known_advertiser_false_negatives: falseNegatives,
    buckets: buckets.map((b) => ({
      ...b,
      yesPct: Number(b.yesPct.toFixed(1)),
    })),
  };

  console.log(JSON.stringify(report, null, 2));

  process.stderr.write(
    [
      `[diagnose] completed=${ordered.length}`,
      cliffIndex == null
        ? '[diagnose] no cliff detected'
        : `[diagnose] cliff at #${cliffIndex + 1} (0-based index ${cliffIndex}) — invalidate ${invalidateCount} empty no_results`,
      `[diagnose] known-advertiser false negatives: ${falseNegatives.length}`,
    ].join('\n') + '\n',
  );
}

main();
