import type { Stage2Stats } from './stage2Checkpoint.js';

export type Stage2ProgressContext = {
  runDir: string;
  inputPath: string;
  resumed: boolean;
  retryErrors?: boolean;
  totalRows: number;
  startingRow: number;
  retryCount?: number;
  startingNavigations: number;
  liAtSet: boolean;
};

export function logStage2Start(ctx: Stage2ProgressContext): void {
  const resumeHint = ctx.retryErrors
    ? `npm run stage2 -- --resume ${ctx.runDir} --input ${ctx.inputPath} --retry-errors`
    : `npm run stage2 -- --resume ${ctx.runDir} --input ${ctx.inputPath}`;
  const mode = ctx.retryErrors
    ? `RETRY ERRORS (${ctx.retryCount ?? 0} rows)`
    : ctx.resumed
      ? 'RESUME'
      : 'new run';
  const rowHint = ctx.retryErrors
    ? `retrying ${ctx.retryCount ?? 0} error rows`
    : `rows: ${ctx.totalRows} (starting at ${ctx.startingRow + 1})`;
  console.error(
    [
      '[stage2] ── starting ──',
      `  run_dir: ${ctx.runDir}`,
      `  input: ${ctx.inputPath}`,
      `  ${rowHint}`,
      `  linkedin_navigations: ${ctx.startingNavigations}`,
      `  li_at: ${ctx.liAtSet ? 'set' : 'not set (guest/blocked likely)'}`,
      `  mode: ${mode}`,
      `  resume: ${resumeHint}`,
      `  extraction_log: ${ctx.runDir}/stage2_extraction_log.jsonl`,
    ].join('\n'),
  );
}

export function logStage2Row(input: {
  done: number;
  total: number;
  stats: Stage2Stats;
  linkedinNavigations: number;
  lastUrl: string;
}): void {
  console.error(
    `[stage2] ${input.done}/${input.total} | ok ${input.stats.ok} | blocked ${input.stats.blocked} | ` +
      `error ${input.stats.error} | nav ${input.linkedinNavigations} | last: ${input.lastUrl.slice(0, 70)}`,
  );
}

export function logStage2Done(input: {
  interrupted: boolean;
  total: number;
  stats: Stage2Stats;
  linkedinNavigations: number;
  runDir: string;
  inputPath: string;
  outputPath: string;
}): void {
  console.error(
    [
      input.interrupted ? '[stage2] ── interrupted ──' : '[stage2] ── complete ──',
      `  rows: ${input.total}`,
      `  ok ${input.stats.ok} | blocked ${input.stats.blocked} | error ${input.stats.error}`,
      `  linkedin_navigations: ${input.linkedinNavigations}`,
      `  output: ${input.outputPath}`,
      `  resume: npm run stage2 -- --resume ${input.runDir} --input ${input.inputPath}`,
    ].join('\n'),
  );
}
