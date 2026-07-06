import type { SpotlightPlacement } from '@/lib/onboarding/types';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

/** Fixed callout width on desktop; narrow viewports span the space instead. */
export const CALLOUT_WIDTH = 380;
/** Gap between the highlighted target and the callout card. */
export const CALLOUT_GAP = 14;
/** Minimum breathing room from any viewport/container edge. */
export const EDGE_PAD = 12;
/** Padding added around the target when drawing the cutout hole. */
export const CUTOUT_PADDING = 8;
/** Tighter padding for mobile bottom-nav circle cutouts (matches icon cell more closely). */
export const NAV_CUTOUT_PADDING = 4;
/** Corner radius for the default (non-nav) spotlight cutout hole. */
export const CUTOUT_BORDER_RADIUS = 12;
/** First-render height guess before the callout has been measured via onLayout. */
export const ESTIMATED_CALLOUT_HEIGHT = 210;

export interface SpotlightHole {
  top: number;
  left: number;
  width: number;
  height: number;
  borderRadius: number | '50%';
}

/**
 * Resolves the spotlight cutout geometry for a measured target rect.
 * Mobile bottom-nav targets get a centered circle; everything else keeps the
 * padded rounded rectangle.
 */
export function resolveSpotlightHole(
  rect: Rect,
  opts: { isNavTarget: boolean; isNarrow: boolean },
): SpotlightHole {
  if (opts.isNavTarget && opts.isNarrow) {
    const size = Math.max(rect.width, rect.height) + NAV_CUTOUT_PADDING * 2;
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    return {
      top: cy - size / 2,
      left: cx - size / 2,
      width: size,
      height: size,
      borderRadius: '50%',
    };
  }
  return {
    top: rect.y - CUTOUT_PADDING,
    left: rect.x - CUTOUT_PADDING,
    width: rect.width + CUTOUT_PADDING * 2,
    height: rect.height + CUTOUT_PADDING * 2,
    borderRadius: CUTOUT_BORDER_RADIUS,
  };
}

type VerticalSide = 'top' | 'bottom';

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

/**
 * Resolves the effective callout side for the current surface.
 *
 * Desktop keeps the authored placement (including `left`/`right`, which have room
 * beside the target). Narrow viewports have no horizontal room, so side
 * placements collapse to `bottom`; nav targets always resolve to `top` because
 * the mobile nav lives at the bottom edge and the card must sit above it.
 */
export function resolveCalloutPlacement(
  preferred: SpotlightPlacement | undefined,
  isNarrow: boolean,
  isNavTarget: boolean,
): SpotlightPlacement {
  const p = preferred ?? 'bottom';
  if (!isNarrow) return p;
  if (isNavTarget) return 'top';
  if (p === 'left' || p === 'right') return 'bottom';
  return p;
}

export interface CalloutPositionArgs {
  /** Target rect in the surface coordinate space (viewport or container). */
  rect: Rect;
  /** Authored placement hint. */
  placement: SpotlightPlacement | undefined;
  /** Size of the coordinate space the callout is positioned within. */
  space: Size;
  /** Callout width (full-bleed on narrow, fixed on desktop). */
  calloutWidth: number;
  /** Measured (or estimated) callout height. */
  calloutHeight: number;
  /** Highest usable y (safe-area top + padding). */
  topLimit: number;
  /** Lowest usable y (space height minus bottom nav / safe area). */
  bottomLimit: number;
  isNarrow: boolean;
  isNavTarget: boolean;
}

export interface CalloutPosition {
  top: number;
  left: number;
  width: number;
}

/**
 * Positions the callout anchored to its target, respecting placement and the
 * usable band between `topLimit` and `bottomLimit`. When the preferred vertical
 * side does not fit it flips to the other side; if neither fits it docks to the
 * side with more free space. Desktop `left`/`right` placements fall back to a
 * vertical side when they would run off-screen.
 */
export function resolveCalloutPosition(args: CalloutPositionArgs): CalloutPosition {
  const {
    rect,
    space,
    calloutWidth: width,
    calloutHeight,
    topLimit,
    bottomLimit,
    isNarrow,
    isNavTarget,
  } = args;
  const placement = resolveCalloutPlacement(args.placement, isNarrow, isNavTarget);

  const centerLeft = rect.x + rect.width / 2 - width / 2;
  const clampLeft = (l: number) => clamp(l, EDGE_PAD, Math.max(EDGE_PAD, space.width - width - EDGE_PAD));
  const clampTop = (t: number) => clamp(t, topLimit, Math.max(topLimit, bottomLimit - calloutHeight));

  if (placement === 'left' || placement === 'right') {
    const left =
      placement === 'left' ? rect.x - CALLOUT_GAP - width : rect.x + rect.width + CALLOUT_GAP;
    if (left >= EDGE_PAD && left + width <= space.width - EDGE_PAD) {
      return { top: clampTop(rect.y), left, width };
    }
    // No horizontal room — fall through to a vertical side.
  }

  const topSideTop = rect.y - CALLOUT_GAP - calloutHeight;
  const bottomSideTop = rect.y + rect.height + CALLOUT_GAP;
  const fitsTop = topSideTop >= topLimit;
  const fitsBottom = bottomSideTop + calloutHeight <= bottomLimit;

  const prefer: VerticalSide = placement === 'top' ? 'top' : 'bottom';

  let side: VerticalSide;
  if (!fitsTop && !fitsBottom) {
    // Neither side fully fits; dock to whichever has more room.
    const spaceAbove = rect.y - topLimit;
    const spaceBelow = bottomLimit - (rect.y + rect.height);
    side = spaceAbove > spaceBelow ? 'top' : 'bottom';
  } else if (prefer === 'top') {
    side = fitsTop ? 'top' : 'bottom';
  } else {
    side = fitsBottom ? 'bottom' : 'top';
  }

  const rawTop = side === 'top' ? topSideTop : bottomSideTop;
  return { top: clampTop(rawTop), left: clampLeft(centerLeft), width };
}

/** Clamps a spotlight hole so it stays within the coordinate space used for rendering. */
export function clampSpotlightHoleToSpace(hole: SpotlightHole, space: Size): SpotlightHole {
  const top = clamp(hole.top, 0, space.height);
  const left = clamp(hole.left, 0, space.width);
  const right = clamp(hole.left + hole.width, 0, space.width);
  const bottom = clamp(hole.top + hole.height, 0, space.height);
  return {
    ...hole,
    top,
    left,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}
