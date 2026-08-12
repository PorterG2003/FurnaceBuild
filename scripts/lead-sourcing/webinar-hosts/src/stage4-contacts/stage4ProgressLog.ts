import type { ApiCallCounts } from '../lib/callCounter.js';
import type { ContactLogEntry, Stage4Stats } from './stage4Checkpoint.js';

export type { ContactLogEntry };

export type Stage4ProgressContext = {
  runDir: string;
  inputPath: string;
  stage2InputPath: string | null;
  resumed: boolean;
  totalEntities: number;
  startingEntity: number;
  icpRejected: number;
  startingApolloCalls: number;
};

export function buildContactLogEntry(input: {
  entityIndex: number;
  companyName: string;
  apolloOrgId: string;
  leadsAdded: number;
  contactTiers: string[];
  posterMatch: boolean;
  zeroLead: boolean;
  error?: string;
  stats: Stage4Stats;
  apiCalls: ApiCallCounts;
}): ContactLogEntry {
  return {
    entity_index: input.entityIndex,
    company_name: input.companyName,
    apollo_org_id: input.apolloOrgId,
    leads_added: input.leadsAdded,
    contact_tiers: input.contactTiers,
    poster_match: input.posterMatch,
    zero_lead: input.zeroLead,
    error: input.error,
    stats: input.stats,
    api_calls: input.apiCalls,
  };
}

export function logStage4Start(ctx: Stage4ProgressContext): void {
  const stage2Line = ctx.stage2InputPath ? `  stage2_input: ${ctx.stage2InputPath}` : '  stage2_input: (none)';
  const resumeHint =
    `npm run stage4 -- --resume ${ctx.runDir} --input ${ctx.inputPath}` +
    (ctx.stage2InputPath ? ` --stage2-input ${ctx.stage2InputPath}` : '');
  console.error(
    [
      '[stage4] ── starting ──',
      `  run_dir: ${ctx.runDir}`,
      `  input: ${ctx.inputPath}`,
      stage2Line,
      `  entities: ${ctx.totalEntities} (starting at ${ctx.startingEntity + 1})`,
      `  icp_rejected: ${ctx.icpRejected}`,
      `  apollo_calls: ${ctx.startingApolloCalls}`,
      ctx.resumed ? '  mode: RESUME' : '  mode: new run',
      `  resume: ${resumeHint}`,
      `  contact_log: ${ctx.runDir}/stage4_contact_log.jsonl`,
    ].join('\n'),
  );
}

export function logStage4Entity(input: {
  done: number;
  total: number;
  stats: Stage4Stats;
  apolloCalls: number;
  lastCompany: string;
}): void {
  console.error(
    `[stage4] ${input.done}/${input.total} | leads ${input.stats.leads} | zero ${input.stats.zero_leads} | ` +
      `poster ${input.stats.poster_matches} | apollo ${input.apolloCalls} | last: ${input.lastCompany.slice(0, 50)}`,
  );
}

export function logStage4Done(input: {
  interrupted: boolean;
  total: number;
  stats: Stage4Stats;
  apolloCalls: number;
  runDir: string;
  inputPath: string;
  stage2InputPath: string | null;
  outputPath: string;
}): void {
  const resumeHint =
    `npm run stage4 -- --resume ${input.runDir} --input ${input.inputPath}` +
    (input.stage2InputPath ? ` --stage2-input ${input.stage2InputPath}` : '');
  console.error(
    [
      input.interrupted ? '[stage4] ── interrupted ──' : '[stage4] ── complete ──',
      `  entities: ${input.total}`,
      `  leads ${input.stats.leads} | zero ${input.stats.zero_leads} | poster ${input.stats.poster_matches}`,
      `  apollo_calls: ${input.apolloCalls}`,
      `  output: ${input.outputPath}`,
      `  resume: ${resumeHint}`,
    ].join('\n'),
  );
}
