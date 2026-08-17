/** Full-width handle hit target; keep in sync with handle chrome in `BottomSheet`. */
export const BOTTOM_SHEET_DRAG_HANDLE_HIT_HEIGHT = 44;

/** Dismiss when dragged this fraction of measured sheet height (or farther). */
export const BOTTOM_SHEET_DRAG_DISMISS_FRACTION = 0.25;

/** Downward pan velocity (px/ms) that dismisses even with a shorter drag. */
export const BOTTOM_SHEET_DRAG_DISMISS_VELOCITY = 1.1;

export type BottomSheetDragReleaseInput = {
  dy: number;
  vy: number;
  sheetHeight: number;
  dismissLocked: boolean;
  takeoverActive: boolean;
};

export type BottomSheetDragReleaseAction =
  | 'ignore'
  | 'dismiss-takeover'
  | 'dismiss-sheet'
  | 'spring-back';

export function shouldDismissBottomSheetDrag(input: {
  dy: number;
  vy: number;
  sheetHeight: number;
}): boolean {
  const height = input.sheetHeight > 0 ? input.sheetHeight : 1;
  return (
    input.dy >= height * BOTTOM_SHEET_DRAG_DISMISS_FRACTION ||
    input.vy >= BOTTOM_SHEET_DRAG_DISMISS_VELOCITY
  );
}

/**
 * Decide what a handle-drag release should do.
 * Takeover-first and dismissLocked match backdrop / hardware-back gating.
 */
export function resolveBottomSheetDragRelease(
  input: BottomSheetDragReleaseInput,
): BottomSheetDragReleaseAction {
  if (!shouldDismissBottomSheetDrag(input)) return 'spring-back';
  if (input.takeoverActive) return 'dismiss-takeover';
  if (input.dismissLocked) return 'ignore';
  return 'dismiss-sheet';
}
