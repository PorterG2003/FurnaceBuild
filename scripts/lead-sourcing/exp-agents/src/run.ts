import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  closeExpBrowser,
  launchExpBrowser,
  waitForHuman,
} from './browser.ts';
import { saveJson } from './checkpoint.ts';
import { countriesFromCli, createRunDir, parseCliArgs } from './cli.ts';
import { runEnumeratePhase } from './enumerate.ts';
import { AdaptiveHealthGate } from './health.ts';
import { runSearchPhase } from './searchNames.ts';
import { runSuggestPhase } from './suggest.ts';

async function main(): Promise<void> {
  const args = parseCliArgs();
  const runDir = args.runDir ?? createRunDir();
  mkdirSync(runDir, { recursive: true });
  const countries = countriesFromCli(args.country);

  const meta = {
    startedAt: new Date().toISOString(),
    country: args.country,
    countries,
    resume: args.resume,
    maxSuggestions: args.maxSuggestions,
    maxAgents: args.maxAgents,
    prefixes: args.prefixes,
    rateMs: args.rateMs,
    headed: args.headed,
    suggestOnly: args.suggestOnly,
    legacyPrefixes: args.legacyPrefixes,
    userDataDir: args.userDataDir ?? null,
    cdpUrl: args.cdpUrl ?? null,
    waitHuman: args.waitHuman,
  };
  writeFileSync(join(runDir, 'run_meta.json'), `${JSON.stringify(meta, null, 2)}\n`, 'utf8');

  console.log(`[run] dir=${runDir}`);
  console.log(
    `[run] countries=${countries.join(',')} resume=${args.resume} headed=${args.headed} rateMs=${args.rateMs}`,
  );
  console.log(
    `[run] maxSuggestions=${args.maxSuggestions ?? 'all'} maxAgents=${args.maxAgents ?? 'all'} prefixes=${args.prefixes?.join(',') ?? 'aa-zz'}`,
  );
  if (args.cdpUrl) console.log(`[run] cdpUrl=${args.cdpUrl}`);
  if (args.userDataDir) console.log(`[run] userDataDir=${args.userDataDir}`);
  if (args.waitHuman) console.log(`[run] waitHuman=true (Enter to continue on captcha soft-ban)`);

  const maxRelaunches = 200;
  let relaunches = 0;
  const healthGate = new AdaptiveHealthGate();
  let suggestNames = 0;
  let prefixesCompleted = 0;
  let suggestCalls = 0;

  while (true) {
    const session = await launchExpBrowser({
      headed: args.headed,
      userDataDir: args.userDataDir,
      cdpUrl: args.cdpUrl,
    });
    try {
      if (!args.legacyPrefixes) {
        const enumeration = await runEnumeratePhase({
          page: session.page,
          runDir,
          countries,
          maxAgents: args.maxAgents,
          rateMs: args.rateMs,
          resume: true,
          healthProbe: (page) => healthGate.assertHealthy(page),
          onUnhealthy: (error, context) => healthGate.trip(error, context),
          onHealthy: () => healthGate.recordDataSuccess(),
        });
        const summary = {
          finishedAt: new Date().toISOString(),
          phase: 'state-province-enumeration',
          agentsWritten: enumeration.agentsWritten,
          pagesCompleted: enumeration.pagesCompleted,
          slicesCompleted: enumeration.slicesCompleted,
          graphqlCalls: enumeration.gqlCalls,
          healthProbeCalls: healthGate.stats.probeCalls,
          browserRelaunches: relaunches,
          sliceCounts: enumeration.sliceCounts,
          agentsCsv: join(runDir, 'agents.csv'),
        };
        saveJson(join(runDir, 'run_summary.json'), summary);
        console.log(
          `[run] enumeration complete: agents=${enumeration.agentsWritten} pages=${enumeration.pagesCompleted} slices=${enumeration.slicesCompleted}`,
        );
        console.log(`[run] output: ${summary.agentsCsv}`);
        return;
      }

      if (args.waitHuman && args.headed) {
        await waitForHuman(
          'Chrome is open on the agents-search page. Click around once (accept cookies if needed) so reCAPTCHA can score a normal session.',
        );
      }

      const suggest = await runSuggestPhase({
        page: session.page,
        runDir,
        countries,
        seedPrefixes: args.prefixes,
        maxSuggestions: args.maxSuggestions,
        rateMs: args.rateMs,
        resume: true,
        waitHuman: args.waitHuman,
        healthGate,
      });
      suggestNames = suggest.suggestions.length;
      prefixesCompleted = suggest.prefixesCompleted;
      suggestCalls += suggest.gqlCalls;

      console.log(
        `[run] suggest complete: names=${suggest.suggestions.length} prefixes=${suggest.prefixesCompleted} calls=${suggest.gqlCalls}`,
      );

      if (args.suggestOnly) {
        const summary = {
          finishedAt: new Date().toISOString(),
          phase: 'suggest-only',
          suggestionNames: suggest.suggestions.length,
          prefixesCompleted: suggest.prefixesCompleted,
          suggestCalls,
        };
        saveJson(join(runDir, 'run_summary.json'), summary);
        console.log(`[run] suggest-only done`);
        return;
      }

      const search = await runSearchPhase({
        page: session.page,
        runDir,
        countries,
        maxAgents: args.maxAgents,
        rateMs: args.rateMs,
        resume: true,
      });

      const summary = {
        finishedAt: new Date().toISOString(),
        suggestionNames: suggestNames,
        prefixesCompleted,
        suggestCalls,
        agentsWritten: search.agentsWritten,
        namesCompleted: search.namesCompleted,
        searchCalls: search.gqlCalls,
        agentsCsv: join(runDir, 'agents.csv'),
        browserRelaunches: relaunches,
      };
      saveJson(join(runDir, 'run_summary.json'), summary);

      console.log(
        `[run] search complete: agents=${search.agentsWritten} names=${search.namesCompleted} calls=${search.gqlCalls}`,
      );
      console.log(`[run] output: ${summary.agentsCsv}`);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const closed = /has been closed|Target closed|Browser closed/i.test(message);
      if (!closed || relaunches >= maxRelaunches) throw error;
      relaunches += 1;
      console.warn(`[run] browser closed; relaunching (${relaunches}/${maxRelaunches}): ${message}`);
      await new Promise((r) => setTimeout(r, 3000));
    } finally {
      await closeExpBrowser(session);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
