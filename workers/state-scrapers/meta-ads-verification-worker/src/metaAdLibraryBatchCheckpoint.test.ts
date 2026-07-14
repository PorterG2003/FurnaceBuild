import assert from 'node:assert/strict';
import test from 'node:test';
import {
  checkpointArgsMatch,
  createEmptyCheckpoint,
  markCheckpointCompleted,
  type MetaAdsBatchCheckpointArgs,
} from './metaAdLibraryBatchCheckpoint.js';

const baseArgs: MetaAdsBatchCheckpointArgs = {
  csvPath: '/tmp/stage3.csv',
  outDir: '/tmp/out',
  headless: true,
  scanWebinars: true,
  webinarScanDays: 30,
  batchMode: 'sample',
  maxRows: null,
  sampleNames: ['Xtalks', 'Supermetrics'],
};

test('checkpointArgsMatch rejects mismatched batch mode', () => {
  const checkpoint = createEmptyCheckpoint(baseArgs);
  assert.throws(() =>
    checkpointArgsMatch(checkpoint, { ...baseArgs, batchMode: 'all' }),
  );
});

test('checkpointArgsMatch rejects mismatched scan flags', () => {
  const checkpoint = createEmptyCheckpoint(baseArgs);
  assert.throws(() =>
    checkpointArgsMatch(checkpoint, { ...baseArgs, scanWebinars: false }),
  );
});

test('markCheckpointCompleted appends domain and result once', () => {
  const checkpoint = createEmptyCheckpoint(baseArgs);
  markCheckpointCompleted(checkpoint, 'xtalks.com', { company_domain: 'xtalks.com', meta_ads_result: 'yes' });
  markCheckpointCompleted(checkpoint, 'xtalks.com', { company_domain: 'xtalks.com', meta_ads_result: 'yes' });
  assert.deepEqual(checkpoint.completedDomains, ['xtalks.com']);
  assert.equal(checkpoint.results.length, 1);
});
