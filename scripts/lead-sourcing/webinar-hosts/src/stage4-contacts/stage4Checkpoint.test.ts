import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assertCheckpointCompatible,
  computeStage4Stats,
  createEmptyCheckpoint,
  entityKey,
  inputFingerprint,
  loadCheckpoint,
  persistStage4State,
} from './stage4Checkpoint.js';
import { rowToRecord, type Stage3Row } from '../lib/types.js';

function sampleEntity(overrides: Partial<Stage3Row> = {}): Stage3Row {
  return rowToRecord({
    company_name: 'Acme Corp',
    company_domain: 'acme.com',
    company_linkedin_url: 'https://linkedin.com/company/acme',
    employee_count: '50',
    industry: 'software',
    apollo_org_id: 'org_1',
    webinar_topic: '',
    webinar_date_mention: '',
    target_audience: '',
    registration_urls: '',
    sample_post_url: 'https://linkedin.com/posts/acme',
    post_count: '1',
    entity_source: 'company_page',
    enrichment_status: 'ok',
    ...overrides,
  }) as Stage3Row;
}

describe('stage4Checkpoint', () => {
  it('roundtrips checkpoint save and load', () => {
    const dir = mkdtempSync(join(tmpdir(), 'stage4-ckpt-'));
    try {
      const inputPath = '/tmp/stage3.csv';
      const passed = [sampleEntity()];
      const fp = inputFingerprint(inputPath, '/tmp/stage2.csv', passed);
      const checkpoint = createEmptyCheckpoint({
        inputPath,
        stage2InputPath: '/tmp/stage2.csv',
        inputFingerprint: fp,
        outputPath: join(dir, 'stage4_webinar_host_leads.csv'),
        rejectedPath: join(dir, 'stage4_rejected_entities.csv'),
        totalEntities: 1,
        totalInputEntities: 1,
        icpPassed: 1,
        pipelineRejected: 0,
        rejected: 0,
      });
      persistStage4State(dir, checkpoint, [], join(dir, 'stage4_webinar_host_leads.csv'));
      const loaded = loadCheckpoint(dir);
      assert.equal(loaded.version, 1);
      assert.equal(loaded.status, 'in_progress');
      assert.equal(loaded.next_entity_index, 0);
      assert.equal(loaded.total_entities, 1);
      assert.deepEqual(loaded.seen_emails, []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects resume when fingerprint mismatches', () => {
    const dir = mkdtempSync(join(tmpdir(), 'stage4-ckpt-'));
    try {
      const inputPath = '/tmp/stage3.csv';
      const passedA = [sampleEntity()];
      const passedB = [sampleEntity({ apollo_org_id: 'org_2' })];
      const checkpoint = createEmptyCheckpoint({
        inputPath,
        stage2InputPath: '/tmp/stage2.csv',
        inputFingerprint: inputFingerprint(inputPath, '/tmp/stage2.csv', passedA),
        outputPath: join(dir, 'stage4_webinar_host_leads.csv'),
        rejectedPath: join(dir, 'stage4_rejected_entities.csv'),
        totalEntities: 1,
        totalInputEntities: 1,
        icpPassed: 1,
        pipelineRejected: 0,
        rejected: 0,
      });
      persistStage4State(dir, checkpoint, [], join(dir, 'stage4_webinar_host_leads.csv'));
      assert.throws(
        () =>
          assertCheckpointCompatible(
            loadCheckpoint(dir),
            inputPath,
            '/tmp/stage2.csv',
            inputFingerprint(inputPath, '/tmp/stage2.csv', passedB),
          ),
        /fingerprint/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects resume when status is completed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'stage4-ckpt-'));
    try {
      const inputPath = '/tmp/stage3.csv';
      const passed = [sampleEntity()];
      const fp = inputFingerprint(inputPath, '/tmp/stage2.csv', passed);
      const checkpoint = createEmptyCheckpoint({
        inputPath,
        stage2InputPath: '/tmp/stage2.csv',
        inputFingerprint: fp,
        outputPath: join(dir, 'stage4_webinar_host_leads.csv'),
        rejectedPath: join(dir, 'stage4_rejected_entities.csv'),
        totalEntities: 1,
        totalInputEntities: 1,
        icpPassed: 1,
        pipelineRejected: 0,
        rejected: 0,
      });
      checkpoint.status = 'completed';
      persistStage4State(dir, checkpoint, [], join(dir, 'stage4_webinar_host_leads.csv'));
      assert.throws(
        () => assertCheckpointCompatible(loadCheckpoint(dir), inputPath, '/tmp/stage2.csv', fp),
        /completed/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('entityKey combines apollo_org_id and sample_post_url', () => {
    const row = sampleEntity();
    assert.equal(entityKey(row), 'org_1|https://linkedin.com/posts/acme');
  });

  it('computeStage4Stats aggregates running counters', () => {
    const stats = computeStage4Stats({
      totalInputEntities: 10,
      icpPassed: 8,
      pipelineRejected: 1,
      rejected: 2,
      leads: [{ email: 'a@b.com' } as never],
      orgSearches: 5,
      posterMatches: 2,
      zeroLeads: 3,
      entitiesProcessed: 5,
    });
    assert.equal(stats.leads, 1);
    assert.equal(stats.zero_leads, 3);
    assert.equal(stats.entities_processed, 5);
    assert.equal(stats.org_searches, 5);
  });
});
