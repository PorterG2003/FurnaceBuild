import { copyFileSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_CLIFF_WINDOW,
  detectCliffIndex,
  isEmptyNoResultRow,
  orderResultsByCompletion,
} from './apifyBatchHealth.js';
import {
  loadApifyCheckpoint,
  saveApifyCheckpoint,
  unmarkApifyCheckpointDomains,
} from './metaAdLibraryApifyCheckpoint.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT_DIR = '../../../../tmp/meta-ads-webinar-batch-full-apify';

function readFlag(argv: string[], name: string): string | null {
  const index = argv.indexOf(name);
  if (index < 0) return null;
  return argv[index + 1] ?? null;
}

function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(name);
}

function main(): void {
  const argv = process.argv.slice(2);
  const dryRun = hasFlag(argv, '--dry-run');
  const outDir = resolve(__dirname, readFlag(argv, '--out-dir') ?? DEFAULT_OUT_DIR);
  const checkpointPath = resolve(outDir, readFlag(argv, '--checkpoint') ?? 'apify-batch-checkpoint.json');
  const fromIndexFlag = readFlag(argv, '--from-index');
  const consecutiveFlag = readFlag(argv, '--after-consecutive-empty');
  const cliffWindow = Number(readFlag(argv, '--cliff-window') ?? DEFAULT_CLIFF_WINDOW);

  const checkpoint = loadApifyCheckpoint(checkpointPath);
  if (!checkpoint) throw new Error(`No checkpoint found at ${checkpointPath}`);

  const ordered = orderResultsByCompletion(checkpoint.completedDomains, checkpoint.results);

  let cliffIndex: number | null;
  if (fromIndexFlag != null) {
    // Accept 1-based (#301) or 0-based; diagnose prints both. Prefer 0-based if value looks like diagnose's cliff_index_0based.
    const raw = Number(fromIndexFlag);
    if (!Number.isFinite(raw) || raw < 0) throw new Error(`Invalid --from-index ${fromIndexFlag}`);
    // Diagnose recommends 1-based in stderr ("cliff at #N"); treat values matching 1-based if --one-based set.
    cliffIndex = hasFlag(argv, '--one-based') ? Math.max(0, raw - 1) : raw;
  } else if (consecutiveFlag != null) {
    const need = Number(consecutiveFlag);
    if (!Number.isFinite(need) || need < 1) {
      throw new Error(`Invalid --after-consecutive-empty ${consecutiveFlag}`);
    }
    cliffIndex = detectCliffIndex(ordered, need);
  } else {
    cliffIndex = detectCliffIndex(ordered, cliffWindow);
  }

  if (cliffIndex == null) {
    throw new Error('Could not determine cliff index. Pass --from-index N (0-based) or --after-consecutive-empty N.');
  }

  const toRemove = ordered
    .slice(cliffIndex)
    .filter((row) => isEmptyNoResultRow(row.result))
    .map((row) => row.domain);

  const backupPath = resolve(outDir, 'apify-batch-checkpoint.pre-invalidate.json');
  const summary = {
    checkpoint: checkpointPath,
    backup: backupPath,
    cliff_index_0based: cliffIndex,
    cliff_index_1based: cliffIndex + 1,
    completed_before: checkpoint.completedDomains.length,
    remove_count: toRemove.length,
    keep_count: checkpoint.completedDomains.length - toRemove.length,
    dry_run: dryRun,
    sample_removed: toRemove.slice(0, 20),
  };

  if (dryRun) {
    console.log(JSON.stringify(summary, null, 2));
    process.stderr.write(`[invalidate] dry-run — would remove ${toRemove.length} domains from index ${cliffIndex}\n`);
    return;
  }

  if (!existsSync(backupPath)) {
    copyFileSync(checkpointPath, backupPath);
  } else {
    // Keep first backup; write a timestamped extra if already present.
    const stamped = resolve(outDir, `apify-batch-checkpoint.pre-invalidate.${Date.now()}.json`);
    copyFileSync(checkpointPath, stamped);
    summary.backup = stamped;
  }

  const removed = unmarkApifyCheckpointDomains(checkpoint, toRemove);
  saveApifyCheckpoint(checkpointPath, checkpoint);

  // Keep results file in sync with checkpoint after invalidate.
  const resultsPath = resolve(outDir, 'webinar-batch-results.json');
  writeFileSync(resultsPath, JSON.stringify(checkpoint.results, null, 2));

  console.log(
    JSON.stringify(
      {
        ...summary,
        removed,
        completed_after: checkpoint.completedDomains.length,
        results_path: resultsPath,
      },
      null,
      2,
    ),
  );
  process.stderr.write(
    `[invalidate] removed ${removed} empty no_results from cliff #${cliffIndex + 1}; ${checkpoint.completedDomains.length} trusted rows remain\n`,
  );
}

main();
