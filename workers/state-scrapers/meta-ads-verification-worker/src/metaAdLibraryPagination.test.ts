import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildScrollPaginationStats,
  mergeScrollSnapshotStep,
} from './metaAdLibraryPagination.js';
import type { MetaAdLibraryResultCard } from './metaAdLibraryParse.js';

function card(id: string, started: string | null = 'Jul 1, 2026'): MetaAdLibraryResultCard {
  return {
    page_name: 'Acme',
    page_id: id,
    page_url: null,
    link_urls: [`https://acme.com/${id}`],
    body_text: null,
    primary_text: `Ad ${id}`,
    headline: null,
    landing_url: `https://acme.com/${id}`,
    cta: null,
    started_running: started,
  };
}

test('mergeScrollSnapshotStep grows merged cards when snapshot adds new ids', () => {
  const merged = [card('1'), card('2')];
  const snapshot = [card('1'), card('2'), card('3'), card('4')];
  const step = mergeScrollSnapshotStep(merged, snapshot.map((c) => c), 0, 0, { webinarScanDays: 30 });
  assert.equal(step.mergedCards.length, 4);
  assert.equal(step.staleScrolls, 0);
  assert.equal(step.stopReason, null);
});

test('mergeScrollSnapshotStep stops after stale scroll limit', () => {
  const merged = [card('1')];
  const snapshot = [card('1')];
  let stale = 0;
  let stopReason: string | null = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const step = mergeScrollSnapshotStep(merged, snapshot, attempt, stale, { webinarScanDays: 30 });
    merged.splice(0, merged.length, ...step.mergedCards);
    stale = step.staleScrolls;
    if (step.stopReason) {
      stopReason = step.stopReason;
      break;
    }
  }
  assert.equal(stopReason, 'stale_scrolls');
});

test('buildScrollPaginationStats marks scroll_helped when cards were added', () => {
  const stats = buildScrollPaginationStats(30, 38, 6, 'stale_scrolls');
  assert.equal(stats.initial_card_count, 30);
  assert.equal(stats.scanned_card_count, 38);
  assert.equal(stats.cards_added_by_scroll, 8);
  assert.equal(stats.scroll_helped, true);
  assert.equal(stats.scroll_attempts, 6);
});
