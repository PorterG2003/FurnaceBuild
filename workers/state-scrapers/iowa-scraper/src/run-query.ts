/**
 * Live Iowa SOS search + parse for a single company name (Playwright).
 * Iowa blocks headless automation — uses headed Chrome by default.
 *
 * Usage: npx tsx src/run-query.ts "Adam Builders"
 * Optional: IOWA_HEADLESS=1 to try headless (usually fails with Access Denied).
 */
import { chromium } from 'playwright';
import { ownerRowsForIowaDetail } from '@furnace/registry-server';
import { scrapeIowaCompanyFromSearchForm } from './iowaBrowser.js';

async function main() {
  const query = (process.argv[2] ?? 'Adam Builders').trim();
  if (!query) {
    console.error('Usage: npx tsx src/run-query.ts "Company Name"');
    process.exit(1);
  }

  const headless = process.env.IOWA_HEADLESS === '1';
  const browser = await chromium.launch({
    headless,
    channel: 'chrome',
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(120_000);

  try {
    const r = await scrapeIowaCompanyFromSearchForm(page, query);
    const owners = r.detail ? ownerRowsForIowaDetail(r.detail) : [];
    console.log(
      JSON.stringify(
        {
          query: r.query,
          error: r.error,
          rateLimited: r.rateLimited,
          hitCount: r.hits.length,
          hitsPreview: r.hits.slice(0, 20),
          pick: r.pick,
          detail: r.detail,
          owners,
          officerNames: r.officerNames,
          registeredAgentName: r.registeredAgentName,
        },
        null,
        2,
      ),
    );
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
