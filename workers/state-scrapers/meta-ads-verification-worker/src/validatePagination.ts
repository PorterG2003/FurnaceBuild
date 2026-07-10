import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { buildMetaAdLibrarySearchUrl } from './metaAdLibraryUrl.js';
import { parseMetaAdLibraryBodyText } from './metaAdLibraryParse.js';
import {
  buildScrollPaginationStats,
  finalizeScrolledSnapshot,
  mergeScrollSnapshotStep,
  SCROLL_SETTLE_MS,
} from './metaAdLibraryPagination.js';
import { dedupeCardsByLibraryId } from './metaAdLibraryWebinarScan.js';

const VALIDATION_DOMAIN = process.env.META_ADS_PAGINATION_DOMAIN ?? 'nike.com';
const MIN_SCROLL_GROWTH = Number(process.env.META_ADS_PAGINATION_MIN_GROWTH ?? 5);

async function validateLivePagination(): Promise<void> {
  const url = buildMetaAdLibrarySearchUrl({
    q: VALIDATION_DOMAIN,
    country: 'US',
    searchType: 'keyword_exact_phrase',
  });
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
  await page.waitForTimeout(2000);

  const waitForCards = async (): Promise<number> => {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const body = await page.locator('body').innerText();
      const count = parseMetaAdLibraryBodyText(body, VALIDATION_DOMAIN).cards.length;
      if (count > 0) return count;
      await page.waitForTimeout(400);
    }
    return 0;
  };
  await waitForCards();

  const initialBody = await page.locator('body').innerText();
  const initialSnapshot = parseMetaAdLibraryBodyText(initialBody, VALIDATION_DOMAIN);
  const initialCount = initialSnapshot.cards.length;
  assert.ok(initialCount > 0, `Expected initial cards for ${VALIDATION_DOMAIN}`);

  let merged = dedupeCardsByLibraryId([...initialSnapshot.cards]);
  let stale = 0;
  let scrollAttempts = 0;
  let stopReason: 'max_attempts' | 'stale_scrolls' | 'date_window' | 'max_cards' = 'max_attempts';

  for (let attempt = 0; attempt < 15; attempt += 1) {
    await page.evaluate(() => window.scrollBy(0, window.innerHeight * 0.9));
    await page.waitForTimeout(SCROLL_SETTLE_MS);
    const snap = parseMetaAdLibraryBodyText(await page.locator('body').innerText(), VALIDATION_DOMAIN);
    scrollAttempts += 1;
    const step = mergeScrollSnapshotStep(merged, snap.cards, attempt, stale, { webinarScanDays: 30 });
    merged = step.mergedCards;
    stale = step.staleScrolls;
    if (step.stopReason) {
      stopReason = step.stopReason;
      break;
    }
  }

  const finalSnapshot = finalizeScrolledSnapshot(initialSnapshot, merged);
  const stats = buildScrollPaginationStats(initialCount, finalSnapshot.cards.length, scrollAttempts, stopReason);

  console.log(JSON.stringify({ domain: VALIDATION_DOMAIN, stats }, null, 2));
  assert.ok(
    stats.cards_added_by_scroll >= MIN_SCROLL_GROWTH,
    `Expected scroll to add at least ${MIN_SCROLL_GROWTH} cards for ${VALIDATION_DOMAIN}, got ${stats.cards_added_by_scroll}`,
  );

  await browser.close();
}

validateLivePagination().catch((error) => {
  console.error(error);
  process.exit(1);
});
