import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadQueriesConfig } from '../lib/config.js';
import {
  assertCheckpointCompatible,
  configFingerprint,
  createEmptyCheckpoint,
  loadCheckpoint,
  mergePageRows,
  persistCheckpointState,
  seenUrlsFromCheckpoint,
} from './stage1Checkpoint.js';
import { rowToRecord } from '../lib/types.js';

function sampleRow(url: string, query = 'q1'): ReturnType<typeof rowToRecord> {
  return rowToRecord({
    result_url: url,
    result_title: 'title',
    result_snippet: '',
    search_query: query,
    serp_position: '1',
    serp_page: '1',
    collected_at: '2026-01-01T00:00:00.000Z',
    slug_hint: '',
    also_matched_queries: '',
  });
}

describe('stage1Checkpoint', () => {
  it('roundtrips checkpoint save and load', () => {
    const dir = mkdtempSync(join(tmpdir(), 'stage1-ckpt-'));
    try {
      const config = loadQueriesConfig({ phrases: ['"test phrase"'] });
      const checkpoint = createEmptyCheckpoint(config, config.phrases);
      const seen = seenUrlsFromCheckpoint(checkpoint);
      persistCheckpointState(dir, checkpoint, [], seen);
      const loaded = loadCheckpoint(dir);
      assert.equal(loaded.version, 1);
      assert.equal(loaded.status, 'in_progress');
      assert.equal(loaded.next_phrase_index, 0);
      assert.equal(loaded.next_page, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects resume when config fingerprint mismatches', () => {
    const dir = mkdtempSync(join(tmpdir(), 'stage1-ckpt-'));
    try {
      const configA = loadQueriesConfig({ phrases: ['"a"'], time_filter: 'qdr:m' });
      const configB = loadQueriesConfig({ phrases: ['"b"'], time_filter: 'qdr:m' });
      const checkpoint = createEmptyCheckpoint(configA, configA.phrases);
      persistCheckpointState(dir, checkpoint, [], new Set());
      assert.throws(() => assertCheckpointCompatible(loadCheckpoint(dir), configB), /fingerprint/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('mergePageRows dedupes and tracks new urls', () => {
    const seen = new Set<string>();
    const urlA = 'https://www.linkedin.com/feed/update/urn:li:activity:111/';
    const urlB = 'https://www.linkedin.com/feed/update/urn:li:activity:222/';
    const first = mergePageRows([], [sampleRow(urlA)], seen);
    assert.equal(first.newUrlCount, 1);
    assert.equal(first.rows.length, 1);

    const second = mergePageRows(first.rows, [sampleRow(urlA), sampleRow(urlB)], seen);
    assert.equal(second.newUrlCount, 1);
    assert.equal(second.rows.length, 2);
  });

  it('configFingerprint is stable for same config', () => {
    const config = loadQueriesConfig({ phrases: ['"a"', '"b"'], time_filter: 'qdr:w' });
    assert.equal(configFingerprint(config), configFingerprint(config));
  });
});
