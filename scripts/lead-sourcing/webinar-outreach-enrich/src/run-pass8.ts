import { copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { asNumber, ensureEnv, outputDir, packageRoot, parseArgs } from './env.js';
import { discoverLinkedInUrls } from './discoverLinkedInUrls.js';
import { ensureDir } from './io.js';
import { prepPass5 } from './pass5Prep.js';
import { prepPass8, seedPersonHints, writePass8Review } from './pass8Prep.js';
import { enrichSubmissions, mergePass5 } from './run-pass5.js';
import { scrapeLandingPeople } from './scrapeLandingPeople.js';
import { scrapeLinkedInProfiles } from './scrapeLinkedInProfiles.js';

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const stage = typeof args.stage === 'string' ? args.stage : '';
  const dryRun = Boolean(args['dry-run']);
  const live = Boolean(args.live);
  const pass1Dir =
    typeof args['pass1-dir'] === 'string'
      ? args['pass1-dir']
      : join(outputDir, 'runs', 'pass1');
  const pass8Dir =
    typeof args['pass8-dir'] === 'string'
      ? args['pass8-dir']
      : join(pass1Dir, 'pass8');
  const pass5Dir = join(pass1Dir, 'pass5');

  if (
    ![
      'prep',
      'scrape-landing',
      'discover-li',
      'scrape-profiles',
      'review',
      'enrich',
      'merge',
      'all',
    ].includes(stage)
  ) {
    console.error(
      'Usage: --stage prep|scrape-landing|discover-li|scrape-profiles|review|enrich|merge|all [--dry-run|--live]',
    );
    process.exit(2);
  }

  ensureDir(pass8Dir);

  if (stage === 'prep' || stage === 'all') {
    prepPass5({ pass1Dir, pass5Dir, packageRoot });
    prepPass8({ pass1Dir, pass8Dir });
  }

  if (stage === 'scrape-landing' || stage === 'all') {
    const input = join(pass8Dir, 'eligible.csv');
    if (!existsSync(input)) throw new Error(`Missing ${input}. Run prep first.`);
    await scrapeLandingPeople({
      inputCsv: input,
      outDir: pass8Dir,
      dryRun,
      maxRows: asNumber(args['max-rows'], null),
      headless: args.headless !== false && args.headless !== 'false',
    });
    if (!dryRun) {
      const added = seedPersonHints(pass8Dir);
      console.log(JSON.stringify({ seeded_person_hints: added }, null, 2));
    }
  }

  if (stage === 'discover-li' || stage === 'all') {
    if (stage === 'discover-li' && !dryRun && !live) {
      console.error('Pass --dry-run or --live for Serper discover-li');
      process.exit(2);
    }
    if (stage === 'all' && !dryRun && !live) {
      console.log(
        JSON.stringify({
          stopped_before: 'discover-li',
          reason: 'pass --live (or --dry-run) for Serper',
        }, null, 2),
      );
      return;
    }
    const peoplePath = join(pass8Dir, 'landing_people.csv');
    if (!existsSync(peoplePath) && !dryRun) {
      throw new Error('Missing landing_people.csv — run scrape-landing first');
    }
    if (live || dryRun) {
      await ensureEnv({ serper: true, apollo: false, prospeo: false });
      await discoverLinkedInUrls({
        inputCsv: peoplePath,
        outDir: pass8Dir,
        dryRun,
        liveConfirmed: live,
        maxRows: asNumber(args['max-rows'], null),
      });
    }
  }

  if (stage === 'scrape-profiles' || (stage === 'all' && (live || dryRun))) {
    const candidates = join(pass8Dir, 'linkedin_candidates.csv');
    if (!existsSync(candidates) && !dryRun) {
      throw new Error('Missing linkedin_candidates.csv — run discover-li first');
    }
    if (existsSync(candidates) || dryRun) {
      await scrapeLinkedInProfiles({
        inputCsv: existsSync(candidates) ? candidates : join(pass8Dir, 'eligible.csv'),
        outDir: pass8Dir,
        dryRun,
        maxRows: asNumber(args['max-rows'], null),
        headless: args.headless !== false && args.headless !== 'false',
      });
    }
  }

  if (stage === 'review' || (stage === 'all' && (live || dryRun))) {
    if (existsSync(join(pass8Dir, 'linkedin_candidates.csv')) || existsSync(join(pass8Dir, 'linkedin_profiles.csv'))) {
      const html = writePass8Review(pass8Dir);
      console.log(JSON.stringify({ review_html: html }, null, 2));
    }
  }

  if (stage === 'enrich') {
    if (!dryRun && !live) {
      console.error('Pass --dry-run or --live for enrich');
      process.exit(2);
    }
    const submissionsPath =
      typeof args.submissions === 'string'
        ? args.submissions
        : join(pass8Dir, 'pass8_submissions.json');
    if (!existsSync(submissionsPath) && !dryRun) {
      throw new Error(`Missing ${submissionsPath}. Accept URLs in pass8_review.html first.`);
    }
    // Enrich into pass8 dir using shared pass5 enricher
    const enrichDir = ensureDir(join(pass8Dir, 'enrich'));
    if (existsSync(submissionsPath)) {
      copyFileSync(submissionsPath, join(enrichDir, 'manual_linkedin_submissions.json'));
    }
    await enrichSubmissions({
      pass5Dir: enrichDir,
      submissionsPath: existsSync(submissionsPath)
        ? submissionsPath
        : join(enrichDir, 'manual_linkedin_submissions.json'),
      dryRun,
      liveConfirmed: live,
      maxRows: asNumber(args['max-rows'], null),
      maxProspeoCredits: asNumber(args['max-prospeo-credits'], 40),
    });
  }

  if (stage === 'merge') {
    const enrichCsv = join(pass8Dir, 'enrich', '5_linkedin_enriched.csv');
    if (!existsSync(enrichCsv)) {
      throw new Error('Missing enrich/5_linkedin_enriched.csv — run enrich first');
    }
    // Copy into pass5 so mergePass5 picks it up, then prefer tip enriched
    ensureDir(pass5Dir);
    copyFileSync(enrichCsv, join(pass5Dir, '5_linkedin_enriched.csv'));
    // Also stage pass8 enriched into pass5 tip path via merge
    const merged = mergePass5({ pass1Dir, pass5Dir });
    // Mirror tip into pass8
    if (existsSync(join(pass5Dir, 'enriched_leads.csv'))) {
      copyFileSync(join(pass5Dir, 'enriched_leads.csv'), join(pass8Dir, 'enriched_leads.csv'));
    }
    prepPass5({ pass1Dir, pass5Dir, packageRoot });
    console.log(JSON.stringify({ ...merged, regen_pass5_worklist: true }, null, 2));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
