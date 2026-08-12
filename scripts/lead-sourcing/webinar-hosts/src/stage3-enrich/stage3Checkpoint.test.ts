import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assertCheckpointCompatible,
  computeStage3Stats,
  createEmptyCheckpoint,
  fingerprintFromGroups,
  inputFingerprint,
  loadCheckpoint,
  persistStage3State,
} from './stage3Checkpoint.js';
import { rowToRecord } from '../lib/types.js';

describe('stage3Checkpoint', () => {
  it('roundtrips checkpoint save and load', () => {
    const dir = mkdtempSync(join(tmpdir(), 'stage3-ckpt-'));
    try {
      const inputPath = '/tmp/stage2.csv';
      const fp = inputFingerprint(inputPath, ['key-a', 'key-b']);
      const checkpoint = createEmptyCheckpoint({
        inputPath,
        inputFingerprint: fp,
        outputPath: join(dir, 'stage3.csv'),
        totalGroups: 10,
      });
      persistStage3State(dir, checkpoint, [], join(dir, 'stage3.csv'));
      const loaded = loadCheckpoint(dir);
      assert.equal(loaded.version, 1);
      assert.equal(loaded.status, 'in_progress');
      assert.equal(loaded.next_group_index, 0);
      assert.equal(loaded.total_groups, 10);
      assert.deepEqual(loaded.shortlink_cache, {});
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects resume when fingerprint mismatches', () => {
    const dir = mkdtempSync(join(tmpdir(), 'stage3-ckpt-'));
    try {
      const checkpoint = createEmptyCheckpoint({
        inputPath: '/tmp/stage2.csv',
        inputFingerprint: inputFingerprint('/tmp/stage2.csv', ['a']),
        outputPath: join(dir, 'stage3.csv'),
        totalGroups: 1,
      });
      persistStage3State(dir, checkpoint, [], join(dir, 'stage3.csv'));
      assert.throws(
        () =>
          assertCheckpointCompatible(
            loadCheckpoint(dir),
            '/tmp/stage2.csv',
            inputFingerprint('/tmp/stage2.csv', ['b']),
          ),
        /fingerprint/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('computeStage3Stats counts statuses', () => {
    const rows = [
      rowToRecord({
        company_name: 'A',
        company_domain: 'a.com',
        company_linkedin_url: '',
        employee_count: '50',
        industry: '',
        apollo_org_id: '1',
        webinar_topic: '',
        webinar_date_mention: '',
        target_audience: '',
        registration_urls: '',
        sample_post_url: 'https://a',
        post_count: '1',
        entity_source: 'company_page',
        enrichment_status: 'ok',
      }),
      rowToRecord({
        company_name: 'B',
        company_domain: 'b.com',
        company_linkedin_url: '',
        employee_count: '',
        industry: '',
        apollo_org_id: '',
        webinar_topic: '',
        webinar_date_mention: '',
        target_audience: '',
        registration_urls: '',
        sample_post_url: 'https://b',
        post_count: '1',
        entity_source: 'registration_domain',
        enrichment_status: 'partial',
      }),
    ];
    assert.deepEqual(computeStage3Stats(rows), { ok: 1, partial: 1, not_found: 0 });
  });

  it('fingerprintFromGroups is stable for same keys', () => {
    const fp1 = fingerprintFromGroups('/in.csv', ['a', 'b']);
    const fp2 = fingerprintFromGroups('/in.csv', ['a', 'b']);
    const fp3 = fingerprintFromGroups('/in.csv', ['b', 'a']);
    assert.equal(fp1, fp2);
    assert.notEqual(fp1, fp3);
  });
});
