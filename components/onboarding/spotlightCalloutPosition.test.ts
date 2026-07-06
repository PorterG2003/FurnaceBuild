import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CALLOUT_WIDTH,
  CUTOUT_BORDER_RADIUS,
  CUTOUT_PADDING,
  NAV_CUTOUT_PADDING,
  EDGE_PAD,
  ESTIMATED_CALLOUT_HEIGHT,
  resolveCalloutPlacement,
  resolveCalloutPosition,
  resolveSpotlightHole,
  type CalloutPositionArgs,
} from './spotlightCalloutPosition';

// Representative iPhone-ish viewport with a notch + home indicator.
const SPACE = { width: 390, height: 844 };
const INSET_TOP = 47;
const NAV_RESERVE = 80 + 34; // BOTTOM_NAV_SCROLL_PADDING + safe-area bottom
const TOP_LIMIT = INSET_TOP + EDGE_PAD;
const BOTTOM_LIMIT = SPACE.height - NAV_RESERVE;
const NARROW_WIDTH = SPACE.width - EDGE_PAD * 2;

function narrowArgs(overrides: Partial<CalloutPositionArgs>): CalloutPositionArgs {
  return {
    rect: { x: 0, y: 0, width: 100, height: 40 },
    placement: 'bottom',
    space: SPACE,
    calloutWidth: NARROW_WIDTH,
    calloutHeight: ESTIMATED_CALLOUT_HEIGHT,
    topLimit: TOP_LIMIT,
    bottomLimit: BOTTOM_LIMIT,
    isNarrow: true,
    isNavTarget: false,
    ...overrides,
  };
}

test('resolveCalloutPlacement collapses side placements to bottom on narrow', () => {
  assert.equal(resolveCalloutPlacement('left', true, false), 'bottom');
  assert.equal(resolveCalloutPlacement('right', true, false), 'bottom');
  assert.equal(resolveCalloutPlacement('top', true, false), 'top');
});

test('resolveCalloutPlacement forces nav targets to top on narrow', () => {
  assert.equal(resolveCalloutPlacement('right', true, true), 'top');
  assert.equal(resolveCalloutPlacement('bottom', true, true), 'top');
});

test('resolveCalloutPlacement keeps authored placement on desktop', () => {
  assert.equal(resolveCalloutPlacement('right', false, true), 'right');
  assert.equal(resolveCalloutPlacement('left', false, false), 'left');
});

test('welcome nav target: callout sits above the bottom nav', () => {
  // A nav icon in the floating bottom bar.
  const rect = { x: 170, y: 774, width: 46, height: 46 };
  const pos = resolveCalloutPosition(
    narrowArgs({ rect, placement: 'right', isNavTarget: true }),
  );
  assert.ok(pos.top < rect.y, 'callout should be above the nav icon');
  assert.ok(pos.top >= TOP_LIMIT, 'callout should clear the safe-area top');
  assert.equal(pos.left, EDGE_PAD, 'full-bleed callout hugs the left edge pad');
  assert.equal(pos.width, NARROW_WIDTH);
});

test('top filter target: callout sits below and clears the bottom nav', () => {
  const rect = { x: 16, y: 96, width: 358, height: 40 };
  const pos = resolveCalloutPosition(narrowArgs({ rect, placement: 'bottom' }));
  assert.ok(pos.top > rect.y + rect.height, 'callout should be below the filter');
  assert.ok(
    pos.top + ESTIMATED_CALLOUT_HEIGHT <= BOTTOM_LIMIT,
    'callout must not overlap the reserved bottom nav band',
  );
});

test('near-bottom target flips a bottom placement up when there is no room below', () => {
  const rect = { x: 40, y: 640, width: 310, height: 44 };
  const pos = resolveCalloutPosition(narrowArgs({ rect, placement: 'bottom' }));
  assert.ok(pos.top < rect.y, 'callout should flip above the target');
});

test('in-sheet (container scope) respects placement top', () => {
  const containerSpace = { width: 390, height: 520 };
  const rect = { x: 16, y: 360, width: 358, height: 48 };
  const pos = resolveCalloutPosition({
    rect,
    placement: 'top',
    space: containerSpace,
    calloutWidth: containerSpace.width - EDGE_PAD * 2,
    calloutHeight: ESTIMATED_CALLOUT_HEIGHT,
    topLimit: EDGE_PAD,
    bottomLimit: containerSpace.height - EDGE_PAD,
    isNarrow: true,
    isNavTarget: false,
  });
  assert.ok(pos.top < rect.y, 'callout should sit above the highlighted row');
  assert.ok(pos.top >= EDGE_PAD, 'callout should stay inside the sheet');
});

test('desktop uses the fixed callout width and honors right placement', () => {
  const rect = { x: 80, y: 200, width: 40, height: 40 };
  const pos = resolveCalloutPosition({
    rect,
    placement: 'right',
    space: { width: 1440, height: 900 },
    calloutWidth: CALLOUT_WIDTH,
    calloutHeight: ESTIMATED_CALLOUT_HEIGHT,
    topLimit: EDGE_PAD,
    bottomLimit: 900 - EDGE_PAD,
    isNarrow: false,
    isNavTarget: true,
  });
  assert.equal(pos.width, CALLOUT_WIDTH);
  assert.ok(pos.left > rect.x + rect.width, 'callout should sit to the right of the target');
});

const NAV_ICON_RECT = { x: 170, y: 774, width: 46, height: 46 };

test('resolveSpotlightHole uses a centered circle for mobile nav targets', () => {
  const hole = resolveSpotlightHole(NAV_ICON_RECT, { isNavTarget: true, isNarrow: true });
  const size = 46 + NAV_CUTOUT_PADDING * 2;
  assert.equal(hole.width, size);
  assert.equal(hole.height, size);
  assert.equal(hole.borderRadius, '50%');
  assert.equal(hole.left, NAV_ICON_RECT.x + NAV_ICON_RECT.width / 2 - size / 2);
  assert.equal(hole.top, NAV_ICON_RECT.y + NAV_ICON_RECT.height / 2 - size / 2);
});

test('resolveSpotlightHole keeps rounded rect for desktop nav targets', () => {
  const hole = resolveSpotlightHole(NAV_ICON_RECT, { isNavTarget: true, isNarrow: false });
  assert.equal(hole.borderRadius, CUTOUT_BORDER_RADIUS);
  assert.equal(hole.left, NAV_ICON_RECT.x - CUTOUT_PADDING);
  assert.equal(hole.top, NAV_ICON_RECT.y - CUTOUT_PADDING);
  assert.equal(hole.width, NAV_ICON_RECT.width + CUTOUT_PADDING * 2);
  assert.equal(hole.height, NAV_ICON_RECT.height + CUTOUT_PADDING * 2);
});

test('resolveSpotlightHole keeps rounded rect for non-nav narrow targets', () => {
  const rect = { x: 16, y: 96, width: 358, height: 40 };
  const hole = resolveSpotlightHole(rect, { isNavTarget: false, isNarrow: true });
  assert.equal(hole.borderRadius, CUTOUT_BORDER_RADIUS);
  assert.equal(hole.left, rect.x - CUTOUT_PADDING);
  assert.equal(hole.top, rect.y - CUTOUT_PADDING);
  assert.equal(hole.width, rect.width + CUTOUT_PADDING * 2);
  assert.equal(hole.height, rect.height + CUTOUT_PADDING * 2);
});
