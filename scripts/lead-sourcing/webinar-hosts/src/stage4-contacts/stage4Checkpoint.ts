import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeCsv } from '../lib/csv.js';
import { STAGE4_LEAD_COLUMNS, type Stage3Row, type Stage4LeadRow } from '../lib/types.js';
import type { ApiCallCounts } from '../lib/callCounter.js';

export type Stage4Stats = {
  entities: number;
  icp_passed: number;
  pipeline_rejected: number;
  leads: number;
  rejected: number;
  org_searches: number;
  poster_matches: number;
  zero_leads: number;
  entities_processed: number;
};

export type ContactLogEntry = {
  entity_index: number;
  company_name: string;
  apollo_org_id: string;
  leads_added: number;
  contact_tiers: string[];
  poster_match: boolean;
  zero_lead: boolean;
  error?: string;
  stats: Stage4Stats;
  api_calls: ApiCallCounts;
};

export const STAGE4_CHECKPOINT_FILE = 'stage4_checkpoint.json';
export const STAGE4_CONTACT_LOG_FILE = 'stage4_contact_log.jsonl';
export const STAGE4_LEADS_CSV_FILE = 'stage4_webinar_host_leads.csv';

export type Stage4Checkpoint = {
  version: 1;
  status: 'in_progress' | 'completed';
  input_path: string;
  stage2_input_path: string | null;
  input_fingerprint: string;
  output_path: string;
  rejected_path: string;
  started_at: string;
  updated_at: string;
  next_entity_index: number;
  total_entities: number;
  total_input_entities: number;
  api_calls: ApiCallCounts;
  stats: Stage4Stats;
  seen_emails: string[];
  leads: Stage4LeadRow[];
};

export function entityKey(row: Stage3Row): string {
  return `${row.apollo_org_id}|${row.sample_post_url}`;
}

export function inputFingerprint(
  inputPath: string,
  stage2Path: string | null,
  passed: Stage3Row[],
): string {
  const payload = JSON.stringify({
    inputPath,
    stage2Path,
    keys: passed.map(entityKey),
  });
  return createHash('sha256').update(payload).digest('hex');
}

export function computeStage4Stats(input: {
  totalInputEntities: number;
  icpPassed: number;
  pipelineRejected: number;
  rejected: number;
  leads: Stage4LeadRow[];
  orgSearches: number;
  posterMatches: number;
  zeroLeads: number;
  entitiesProcessed: number;
}): Stage4Stats {
  return {
    entities: input.totalInputEntities,
    icp_passed: input.icpPassed,
    pipeline_rejected: input.pipelineRejected,
    leads: input.leads.length,
    rejected: input.rejected,
    org_searches: input.orgSearches,
    poster_matches: input.posterMatches,
    zero_leads: input.zeroLeads,
    entities_processed: input.entitiesProcessed,
  };
}

export function checkpointPath(runDir: string): string {
  return join(runDir, STAGE4_CHECKPOINT_FILE);
}

export function contactLogPath(runDir: string): string {
  return join(runDir, STAGE4_CONTACT_LOG_FILE);
}

export function defaultLeadsCsvPath(runDir: string): string {
  return join(runDir, STAGE4_LEADS_CSV_FILE);
}

export function createEmptyCheckpoint(input: {
  inputPath: string;
  stage2InputPath: string | null;
  inputFingerprint: string;
  outputPath: string;
  rejectedPath: string;
  totalEntities: number;
  totalInputEntities: number;
  icpPassed: number;
  pipelineRejected: number;
  rejected: number;
}): Stage4Checkpoint {
  const now = new Date().toISOString();
  return {
    version: 1,
    status: 'in_progress',
    input_path: input.inputPath,
    stage2_input_path: input.stage2InputPath,
    input_fingerprint: input.inputFingerprint,
    output_path: input.outputPath,
    rejected_path: input.rejectedPath,
    started_at: now,
    updated_at: now,
    next_entity_index: 0,
    total_entities: input.totalEntities,
    total_input_entities: input.totalInputEntities,
    api_calls: {
      serper_searches: 0,
      apollo_org_calls: 0,
      apollo_people_calls: 0,
      openrouter_calls: 0,
      linkedin_navigations: 0,
    },
    stats: computeStage4Stats({
      totalInputEntities: input.totalInputEntities,
      icpPassed: input.icpPassed,
      pipelineRejected: input.pipelineRejected,
      rejected: input.rejected,
      leads: [],
      orgSearches: 0,
      posterMatches: 0,
      zeroLeads: 0,
      entitiesProcessed: 0,
    }),
    seen_emails: [],
    leads: [],
  };
}

export function loadCheckpoint(runDir: string): Stage4Checkpoint {
  const path = checkpointPath(runDir);
  if (!existsSync(path)) {
    throw new Error(`No Stage 4 checkpoint found at ${path}. Start a new run or check the run directory.`);
  }
  return JSON.parse(readFileSync(path, 'utf8')) as Stage4Checkpoint;
}

export function assertCheckpointCompatible(
  checkpoint: Stage4Checkpoint,
  inputPath: string,
  stage2Path: string | null,
  fingerprint: string,
): void {
  if (checkpoint.input_fingerprint !== fingerprint) {
    throw new Error(
      'Stage 4 checkpoint input fingerprint does not match (input CSV or stage2 changed). Start a new run.',
    );
  }
  if (resolvePath(checkpoint.input_path) !== resolvePath(inputPath)) {
    throw new Error(
      `Stage 4 checkpoint input path mismatch. Expected ${checkpoint.input_path}, got ${inputPath}.`,
    );
  }
  const expectedStage2 = stage2Path ? resolvePath(stage2Path) : null;
  const checkpointStage2 = checkpoint.stage2_input_path ? resolvePath(checkpoint.stage2_input_path) : null;
  if (checkpointStage2 !== expectedStage2) {
    throw new Error(
      `Stage 4 checkpoint stage2 path mismatch. Expected ${checkpoint.stage2_input_path}, got ${stage2Path}.`,
    );
  }
  if (checkpoint.status === 'completed') {
    throw new Error('Stage 4 checkpoint is already completed. Start a new run or use the existing CSV output.');
  }
}

function resolvePath(path: string): string {
  return path.replace(/\\/g, '/');
}

export function persistStage4State(
  runDir: string,
  checkpoint: Stage4Checkpoint,
  leads: Stage4LeadRow[],
  csvOutputPath?: string,
): void {
  mkdirSync(runDir, { recursive: true });
  checkpoint.updated_at = new Date().toISOString();
  checkpoint.leads = leads;
  writeFileSync(checkpointPath(runDir), `${JSON.stringify(checkpoint, null, 2)}\n`, 'utf8');
  writeCsv(csvOutputPath ?? checkpoint.output_path, leads, [...STAGE4_LEAD_COLUMNS]);
}

export function appendContactLog(runDir: string, entry: ContactLogEntry): void {
  mkdirSync(runDir, { recursive: true });
  appendFileSync(contactLogPath(runDir), `${JSON.stringify(entry)}\n`, 'utf8');
}
