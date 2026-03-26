/**
 * One-off: load Utah portal, click entity search, run a sample search, save HTML for parser fixtures.
 * Run: npm run capture-fixtures (from workers/state-scrapers/utah-scraper)
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(__dirname, '../../../../lib/foundry/registry-server/fixtures');

async function main() {
  await mkdir(FIXTURES, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(90000);

  await page.goto('https://businessregistration.utah.gov/', { waitUntil: 'domcontentloaded' });

  await page.getByRole('link', { name: /Search Business Entity Records/i }).first().click();
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForSelector('#BusinessSearch_Index_txtEntityName', { timeout: 30000 });
  await writeFile(path.join(FIXTURES, 'utah-entity-search-after-click.html'), await page.content(), 'utf8');

  await page.locator('#BusinessSearch_Index_rdContains').check();
  await page.locator('#BusinessSearch_Index_txtEntityName').fill('365 HEATING');
  await page.locator('#btnSearch').click();
  await page.getByText('365 HEATING', { exact: false }).first().waitFor({ state: 'visible', timeout: 90000 });
  await writeFile(path.join(FIXTURES, 'utah-entity-search-results.html'), await page.content(), 'utf8');

  const llcLink = page.locator('#grid_businessList tbody a').filter({ hasText: /365 HEATING.*AIR LLC/i }).first();
  await llcLink.click();
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(4000);
  await writeFile(path.join(FIXTURES, 'utah-entity-detail-sample.html'), await page.content(), 'utf8');

  await browser.close();
  console.log('Wrote fixtures to', FIXTURES);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
