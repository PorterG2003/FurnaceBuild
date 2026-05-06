import type { RefObject } from 'react';
import type { ScrollView } from 'react-native';

/**
 * Scroll only the given RN-web `ScrollView`'s DOM node so the focused field stays
 * above the keyboard / visual viewport — does not scroll `window` or outer layout.
 */
export function scrollFocusedInputWithinSheetScrollViewWeb(
  scrollRef: RefObject<ScrollView | null>,
  marginBelowInput = 16
): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;

  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || !active.matches('input, textarea, [contenteditable="true"]')) {
    return;
  }

  const scrollView = scrollRef.current as unknown as {
    getScrollableNode?: () => HTMLElement | null;
  } | null;
  const scrollEl = scrollView?.getScrollableNode?.();
  if (!scrollEl || scrollEl.scrollHeight <= scrollEl.clientHeight + 1) return;

  if (!scrollEl.contains(active)) return;

  const vv = window.visualViewport;
  const visibleBottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
  const targetBottom = visibleBottom - marginBelowInput;

  const inputRect = active.getBoundingClientRect();
  const scrollRect = scrollEl.getBoundingClientRect();

  if (inputRect.bottom <= targetBottom && inputRect.top >= scrollRect.top - 4) {
    return;
  }

  if (inputRect.bottom > targetBottom) {
    scrollEl.scrollTop += inputRect.bottom - targetBottom;
    return;
  }

  if (inputRect.top < scrollRect.top + 8) {
    scrollEl.scrollTop -= scrollRect.top + 8 - inputRect.top;
  }
}
