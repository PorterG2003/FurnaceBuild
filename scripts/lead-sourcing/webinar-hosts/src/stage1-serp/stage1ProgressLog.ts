import { ESTIMATED_SERP_PAGES_PER_QUERY } from '../lib/callCounter.js';
import type { QueryStopReason } from './stage1Checkpoint.js';

export type Stage1ProgressContext = {
  runDir: string;
  resumed: boolean;
  totalPhrases: number;
  endPhraseIndex: number;
  creditCeiling: number;
  startingCredits: number;
  startingUnique: number;
};

export function creditCeiling(endPhraseIndex: number, pageCap: number | null): number {
  const pagesPerQuery = pageCap ?? ESTIMATED_SERP_PAGES_PER_QUERY;
  return endPhraseIndex * pagesPerQuery;
}

export function logStage1Start(ctx: Stage1ProgressContext): void {
  const resumeHint = `npm run stage1 -- --resume ${ctx.runDir}`;
  console.error(
    [
      '[stage1] ── starting ──',
      `  run_dir: ${ctx.runDir}`,
      `  queries: ${ctx.endPhraseIndex}/${ctx.totalPhrases} phrases`,
      `  serper_credits: ${ctx.startingCredits} used (ceiling ~${ctx.creditCeiling} if no yield stop)`,
      `  unique_urls: ${ctx.startingUnique}`,
      ctx.resumed ? `  mode: RESUME` : `  mode: new run`,
      `  resume: ${resumeHint}`,
      `  page_log: ${ctx.runDir}/stage1_page_log.jsonl`,
    ].join('\n'),
  );
}

export function logStage1QueryStart(phraseIndex: number, total: number, phrase: string): void {
  console.error(`[stage1] ▶ query ${phraseIndex + 1}/${total}: ${phrase}`);
}

export function logStage1Page(input: {
  phraseIndex: number;
  totalPhrases: number;
  serpPage: number;
  creditsUsed: number;
  creditCeiling: number;
  newUrls: number;
  cumulativeUnique: number;
  action: string;
  queryNewUrls: number;
  queryPages: number;
}): void {
  const pct =
    input.creditCeiling > 0
      ? Math.min(100, Math.round((input.creditsUsed / input.creditCeiling) * 100))
      : 0;
  const efficiency =
    input.creditsUsed > 0
      ? (input.cumulativeUnique / input.creditsUsed).toFixed(1)
      : '—';
  console.error(
    `[stage1]   q${input.phraseIndex + 1}/${input.totalPhrases} p${input.serpPage} | ` +
      `credits ${input.creditsUsed}/${input.creditCeiling} (${pct}%) | ` +
      `+${input.newUrls} new → ${input.cumulativeUnique} unique | ` +
      `${efficiency} urls/credit | query +${input.queryNewUrls} in ${input.queryPages}p | ${input.action}`,
  );
}

export function logStage1QueryDone(input: {
  phraseIndex: number;
  totalPhrases: number;
  pagesFetched: number;
  queryNewUrls: number;
  creditsUsed: number;
  cumulativeUnique: number;
  stopReason: QueryStopReason;
}): void {
  console.error(
    `[stage1] ✓ query ${input.phraseIndex + 1}/${input.totalPhrases} done | ` +
      `${input.pagesFetched} pages | +${input.queryNewUrls} new | ` +
      `credits ${input.creditsUsed} total | ${input.cumulativeUnique} unique | stop: ${input.stopReason}`,
  );
}

export function logStage1Done(input: {
  interrupted: boolean;
  creditsUsed: number;
  creditCeiling: number;
  cumulativeUnique: number;
  queriesRun: number;
  totalPhrases: number;
  runDir: string;
  yieldSummary: Record<string, number>;
}): void {
  const pct =
    input.creditCeiling > 0
      ? Math.round((input.creditsUsed / input.creditCeiling) * 100)
      : 0;
  console.error(
    [
      input.interrupted ? '[stage1] ── interrupted ──' : '[stage1] ── complete ──',
      `  queries: ${input.queriesRun}/${input.totalPhrases}`,
      `  serper_credits: ${input.creditsUsed} (~${pct}% of ${input.creditCeiling} ceiling)`,
      `  unique_urls: ${input.cumulativeUnique}`,
      `  yield_stops: ${JSON.stringify(input.yieldSummary)}`,
      `  resume: npm run stage1 -- --resume ${input.runDir}`,
    ].join('\n'),
  );
}
