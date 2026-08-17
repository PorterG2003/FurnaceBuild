import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BOTTOM_SHEET_DRAG_DISMISS_FRACTION,
  BOTTOM_SHEET_DRAG_DISMISS_VELOCITY,
  BOTTOM_SHEET_DRAG_HANDLE_HIT_HEIGHT,
  resolveBottomSheetDragRelease,
  shouldDismissBottomSheetDrag,
} from './bottomSheetDrag';

const sheetHeight = 400;
const pastDy = sheetHeight * BOTTOM_SHEET_DRAG_DISMISS_FRACTION;

test('shouldDismissBottomSheetDrag uses distance or downward velocity', () => {
  assert.equal(shouldDismissBottomSheetDrag({ dy: pastDy, vy: 0, sheetHeight }), true);
  assert.equal(shouldDismissBottomSheetDrag({ dy: pastDy - 1, vy: 0, sheetHeight }), false);
  assert.equal(
    shouldDismissBottomSheetDrag({
      dy: 20,
      vy: BOTTOM_SHEET_DRAG_DISMISS_VELOCITY,
      sheetHeight,
    }),
    true,
  );
  assert.equal(
    shouldDismissBottomSheetDrag({
      dy: 20,
      vy: BOTTOM_SHEET_DRAG_DISMISS_VELOCITY - 0.01,
      sheetHeight,
    }),
    false,
  );
  assert.equal(shouldDismissBottomSheetDrag({ dy: 80, vy: -2, sheetHeight }), false);
});

test('resolveBottomSheetDragRelease springs back below threshold', () => {
  assert.equal(
    resolveBottomSheetDragRelease({
      dy: 20,
      vy: 0,
      sheetHeight,
      dismissLocked: false,
      takeoverActive: false,
    }),
    'spring-back',
  );
});

test('resolveBottomSheetDragRelease dismisses the sheet when unlocked', () => {
  assert.equal(
    resolveBottomSheetDragRelease({
      dy: pastDy,
      vy: 0,
      sheetHeight,
      dismissLocked: false,
      takeoverActive: false,
    }),
    'dismiss-sheet',
  );
});

test('resolveBottomSheetDragRelease dismisses takeover first', () => {
  assert.equal(
    resolveBottomSheetDragRelease({
      dy: pastDy,
      vy: 0,
      sheetHeight,
      dismissLocked: false,
      takeoverActive: true,
    }),
    'dismiss-takeover',
  );
  assert.equal(
    resolveBottomSheetDragRelease({
      dy: pastDy,
      vy: 0,
      sheetHeight,
      dismissLocked: true,
      takeoverActive: true,
    }),
    'dismiss-takeover',
  );
});

test('resolveBottomSheetDragRelease ignores a dismiss when locked with no takeover', () => {
  assert.equal(
    resolveBottomSheetDragRelease({
      dy: pastDy,
      vy: 0,
      sheetHeight,
      dismissLocked: true,
      takeoverActive: false,
    }),
    'ignore',
  );
});

test('handle hit height is the expanded drag target', () => {
  assert.equal(BOTTOM_SHEET_DRAG_HANDLE_HIT_HEIGHT, 44);
});
