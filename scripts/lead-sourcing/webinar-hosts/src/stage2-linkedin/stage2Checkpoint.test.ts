import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assertCheckpointCompatible,
  computeStage2Stats,
  createEmptyCheckpoint,
  fingerprintFromInput,
  inputFingerprint,
  loadCheckpoint,
  persistCheckpointState,
} from './stage2Checkpoint.js';
import { rowToRecord } from '../lib/types.js';

describe('stage2Checkpoint', () => {
  it('roundtrips checkpoint save and load', () => {
    const dir = mkdtempSync(join(tmpdir(), 'stage2-ckpt-'));
    try {
      const inputPath = '/tmp/stage1.csv';
      const fp = inputFingerprint(inputPath, null, ['https://example.com/a']);
      const checkpoint = createEmptyCheckpoint({
        inputPath,
        inputFingerprint: fp,
        outputPath: join(dir, 'stage2.csv'),
        totalRows: 10,
      });
      persistCheckpointState(dir, checkpoint, [], join(dir, 'stage2.csv'));
      const loaded = loadCheckpoint(dir);
      assert.equal(loaded.version, 1);
      assert.equal(loaded.status, 'in_progress');
      assert.equal(loaded.next_row_index, 0);
      assert.equal(loaded.total_rows, 10);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects resume when fingerprint mismatches', () => {
    const dir = mkdtempSync(join(tmpdir(), 'stage2-ckpt-'));
    try {
      const checkpoint = createEmptyCheckpoint({
        inputPath: '/tmp/stage1.csv',
        inputFingerprint: inputFingerprint('/tmp/stage1.csv', null, ['a']),
        outputPath: join(dir, 'stage2.csv'),
        totalRows: 1,
      });
      persistCheckpointState(dir, checkpoint, [], join(dir, 'stage2.csv'));
      assert.throws(
        () =>
          assertCheckpointCompatible(
            loadCheckpoint(dir),
            '/tmp/stage1.csv',
            inputFingerprint('/tmp/stage1.csv', 5, ['a']),
          ),
        /fingerprint/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('computeStage2Stats counts statuses', () => {
    const rows = [
      rowToRecord({
        result_url: 'https://a',
        result_title: '',
        result_snippet: '',
        search_query: '',
        serp_position: '1',
        serp_page: '1',
        collected_at: '',
        slug_hint: '',
        also_matched_queries: '',
        post_text: '',
        author_name: '',
        author_profile_url: '',
        entity_type: 'company',
        registration_urls: '',
        posted_at: '',
        extraction_status: 'ok',
        extraction_error: '',
      }),
      rowToRecord({
        result_url: 'https://b',
        result_title: '',
        result_snippet: '',
        search_query: '',
        serp_position: '2',
        serp_page: '1',
        collected_at: '',
        slug_hint: '',
        also_matched_queries: '',
        post_text: '',
        author_name: '',
        author_profile_url: '',
        entity_type: 'unknown',
        registration_urls: '',
        posted_at: '',
        extraction_status: 'blocked',
        extraction_error: '',
      }),
    ];
    assert.deepEqual(computeStage2Stats(rows), { ok: 1, blocked: 1, error: 0 });
  });

  it('fingerprintFromInput includes maxRows', () => {
    const rows = [{ result_url: 'https://a' }, { result_url: 'https://b' }] as never[];
    const fpAll = fingerprintFromInput('/in.csv', null, rows);
    const fpOne = fingerprintFromInput('/in.csv', 1, rows);
    assert.notEqual(fpAll, fpOne);
  });
});
