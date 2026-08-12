import type { Stage3Stats } from './stage3Checkpoint.js';

export type Stage3ProgressContext = {
  runDir: string;
  inputPath: string;
  resumed: boolean;
  totalGroups: number;
  startingGroup: number;
  startingApiCalls: number;
  maxApolloCalls: number | null;
};

export function logStage3Start(ctx: Stage3ProgressContext): void {
  const resumeHint = `npm run stage3 -- --resume ${ctx.runDir} --input ${ctx.inputPath}`;
  console.error(
    [
      '[stage3] ── starting ──',
      `  run_dir: ${ctx.runDir}`,
      `  input: ${ctx.inputPath}`,
      `  groups: ${ctx.totalGroups} (starting at ${ctx.startingGroup + 1})`,
      `  apollo_calls: ${ctx.startingApiCalls}${ctx.maxApolloCalls != null ? ` / ${ctx.maxApolloCalls} budget` : ''}`,
      ctx.resumed ? '  mode: RESUME' : '  mode: new run',
      `  resume: ${resumeHint}`,
      `  enrichment_log: ${ctx.runDir}/stage3_enrichment_log.jsonl`,
    ].join('\n'),
  );
}

export function logStage3Group(input: {
  done: number;
  total: number;
  stats: Stage3Stats;
  apolloCalls: number;
  lastCompany: string;
}): void {
  console.error(
    `[stage3] ${input.done}/${input.total} | ok ${input.stats.ok} | partial ${input.stats.partial} | ` +
      `not_found ${input.stats.not_found} | apollo ${input.apolloCalls} | last: ${input.lastCompany.slice(0, 50)}`,
  );
}

export function logStage3Done(input: {
  interrupted: boolean;
  total: number;
  stats: Stage3Stats;
  apolloCalls: number;
  runDir: string;
  inputPath: string;
  outputPath: string;
}): void {
  console.error(
    [
      input.interrupted ? '[stage3] ── interrupted ──' : '[stage3] ── complete ──',
      `  groups: ${input.total}`,
      `  ok ${input.stats.ok} | partial ${input.stats.partial} | not_found ${input.stats.not_found}`,
      `  apollo_calls: ${input.apolloCalls}`,
      `  output: ${input.outputPath}`,
      `  resume: npm run stage3 -- --resume ${input.runDir} --input ${input.inputPath}`,
    ].join('\n'),
  );
}
