import {
  dedupeCardsByLibraryId,
  META_ADS_MAX_SCANNED_CARDS,
  META_ADS_MAX_SCROLL_ATTEMPTS,
  oldestDatedCardIsBeforeDays,
  type MetaAdLibraryResultCard,
} from './metaAdLibraryWebinarScan.js';
import type { MetaAdLibraryPageSnapshot } from './metaAdLibraryParse.js';

export const SCROLL_SETTLE_MS = 800;
export const SCROLL_STALE_LIMIT = 4;

export type ScrollPaginationStopReason =
  | 'not_needed'
  | 'max_cards'
  | 'max_attempts'
  | 'stale_scrolls'
  | 'date_window';

export interface ScrollPaginationStats {
  initial_card_count: number;
  scanned_card_count: number;
  scroll_attempts: number;
  cards_added_by_scroll: number;
  scroll_helped: boolean;
  stopped_reason: ScrollPaginationStopReason;
}

export interface ScrollMergeStepResult {
  mergedCards: MetaAdLibraryResultCard[];
  staleScrolls: number;
  stopReason: ScrollPaginationStopReason | null;
}

export interface ScrollMergeStepOptions {
  maxAttempts?: number;
  maxCards?: number;
  staleLimit?: number;
  webinarScanDays: number;
  now?: Date;
}

export function mergeScrollSnapshotStep(
  mergedCards: MetaAdLibraryResultCard[],
  snapshotCards: MetaAdLibraryResultCard[],
  attempt: number,
  staleScrolls: number,
  options: ScrollMergeStepOptions,
): ScrollMergeStepResult {
  const maxAttempts = options.maxAttempts ?? META_ADS_MAX_SCROLL_ATTEMPTS;
  const maxCards = options.maxCards ?? META_ADS_MAX_SCANNED_CARDS;
  const staleLimit = options.staleLimit ?? SCROLL_STALE_LIMIT;

  if (mergedCards.length >= maxCards) {
    return { mergedCards, staleScrolls, stopReason: 'max_cards' };
  }
  if (attempt >= maxAttempts) {
    return { mergedCards, staleScrolls, stopReason: 'max_attempts' };
  }

  const beforeCount = mergedCards.length;
  const nextMerged = dedupeCardsByLibraryId([...mergedCards, ...snapshotCards]).slice(0, maxCards);
  let nextStale = staleScrolls;
  let stopReason: ScrollPaginationStopReason | null = null;

  if (nextMerged.length === beforeCount) {
    nextStale += 1;
    if (nextStale >= staleLimit) stopReason = 'stale_scrolls';
  } else {
    nextStale = 0;
  }

  if (
    !stopReason &&
    oldestDatedCardIsBeforeDays(nextMerged, options.webinarScanDays, options.now) &&
    nextStale >= staleLimit
  ) {
    stopReason = 'date_window';
  }

  return { mergedCards: nextMerged, staleScrolls: nextStale, stopReason };
}

export function buildScrollPaginationStats(
  initialCardCount: number,
  finalCardCount: number,
  scrollAttempts: number,
  stoppedReason: ScrollPaginationStopReason,
): ScrollPaginationStats {
  const cardsAdded = Math.max(0, finalCardCount - initialCardCount);
  return {
    initial_card_count: initialCardCount,
    scanned_card_count: finalCardCount,
    scroll_attempts: scrollAttempts,
    cards_added_by_scroll: cardsAdded,
    scroll_helped: cardsAdded > 0,
    stopped_reason: stoppedReason,
  };
}

export function finalizeScrolledSnapshot(
  initialSnapshot: MetaAdLibraryPageSnapshot,
  mergedCards: MetaAdLibraryResultCard[],
): MetaAdLibraryPageSnapshot {
  return {
    ...initialSnapshot,
    cards: mergedCards,
  };
}
