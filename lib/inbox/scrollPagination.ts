/** Distance from the top of the message scroller that triggers older-history load. */
export const MESSAGE_LOAD_OLDER_TOP_THRESHOLD_PX = 120;

/** Distance from the bottom of the thread list that triggers the next page. */
export const THREAD_LIST_LOAD_MORE_BOTTOM_THRESHOLD_PX = 160;

export function shouldLoadOlderMessagesOnScroll(params: {
  offsetY: number;
  hasOlder: boolean;
  loading: boolean;
  thresholdPx?: number;
}): boolean {
  if (!params.hasOlder || params.loading) return false;
  const threshold = params.thresholdPx ?? MESSAGE_LOAD_OLDER_TOP_THRESHOLD_PX;
  return params.offsetY <= threshold;
}

export function shouldLoadMoreThreadsOnScroll(params: {
  offsetY: number;
  viewportHeight: number;
  contentHeight: number;
  hasMore: boolean;
  loading: boolean;
  thresholdPx?: number;
}): boolean {
  if (!params.hasMore || params.loading) return false;
  if (params.contentHeight <= 0 || params.viewportHeight <= 0) return false;
  const threshold = params.thresholdPx ?? THREAD_LIST_LOAD_MORE_BOTTOM_THRESHOLD_PX;
  const distanceFromBottom =
    params.contentHeight - (params.offsetY + params.viewportHeight);
  return distanceFromBottom <= threshold;
}
