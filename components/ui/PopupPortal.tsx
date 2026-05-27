/**
 * PopupPortal — a shared primitive for positioned popups (dropdowns, pickers, tooltips).
 *
 * Web:    renders via createPortal into document.body with position:fixed.
 *         Two-pass positioning avoids flash: first render is hidden at off-screen
 *         coords, useLayoutEffect measures the popup, then immediately applies the
 *         correct position before the browser paints.
 *
 * Native: renders via a transparent full-screen Modal (same pattern as Select.tsx),
 *         with an absolutely-positioned child whose coords are computed from
 *         measureInWindow.
 *
 * Both platforms use the same flip + clamp algorithm:
 *   - Flip: if the popup would overflow on the preferred side, try the opposite side.
 *   - Clamp: keep the cross-axis position inside the viewport with EDGE_PAD margin.
 */

import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import {
  Modal,
  Platform,
  Pressable,
  View,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PopupPlacement =
  | 'top'
  | 'top-start'
  | 'top-end'
  | 'bottom'
  | 'bottom-start'
  | 'bottom-end'
  | 'left'
  | 'left-start'
  | 'left-end'
  | 'right'
  | 'right-start'
  | 'right-end';

export interface PopupPortalProps {
  /** Ref to the trigger element the popup should be anchored to. */
  anchorRef: RefObject<View | null>;
  open: boolean;
  onClose?: () => void;
  placement?: PopupPlacement;
  /** Pixel gap between anchor edge and popup. Default: 6. */
  gap?: number;
  /**
   * When false the popup div gets pointerEvents: 'none'.
   * Use for tooltips that must not capture pointer events.
   * Default: true.
   */
  interactive?: boolean;
  /** Make the popup at least as wide as the anchor. */
  sameWidth?: boolean;
  children: ReactNode;
  /** Optional extra style applied to the popup wrapper (web + native). */
  style?: StyleProp<ViewStyle>;
}

// ---------------------------------------------------------------------------
// Positioning helpers
// ---------------------------------------------------------------------------

const EDGE_PAD = 8;

interface AnchorRect {
  ax: number;
  ay: number;
  aw: number;
  ah: number;
}

interface PopupSize {
  pw: number;
  ph: number;
}

interface Position {
  top: number;
  left: number;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Compute raw top/left for a given placement.
 * All values are in viewport (fixed) coordinates.
 */
function rawPosition(
  placement: PopupPlacement,
  { ax, ay, aw, ah }: AnchorRect,
  { pw, ph }: PopupSize,
  gap: number,
): Position {
  switch (placement) {
    case 'bottom-start': return { top: ay + ah + gap, left: ax };
    case 'bottom-end':   return { top: ay + ah + gap, left: ax + aw - pw };
    case 'bottom':       return { top: ay + ah + gap, left: ax + aw / 2 - pw / 2 };
    case 'top-start':    return { top: ay - ph - gap, left: ax };
    case 'top-end':      return { top: ay - ph - gap, left: ax + aw - pw };
    case 'top':          return { top: ay - ph - gap, left: ax + aw / 2 - pw / 2 };
    case 'left':         return { top: ay + ah / 2 - ph / 2, left: ax - pw - gap };
    case 'left-start':   return { top: ay, left: ax - pw - gap };
    case 'left-end':     return { top: ay + ah - ph, left: ax - pw - gap };
    case 'right':        return { top: ay + ah / 2 - ph / 2, left: ax + aw + gap };
    case 'right-start':  return { top: ay, left: ax + aw + gap };
    case 'right-end':    return { top: ay + ah - ph, left: ax + aw + gap };
  }
}

/**
 * Given the preferred placement, try to flip to the opposite side if it
 * overflows, then clamp the cross-axis so nothing escapes the viewport.
 */
function computePosition(
  preferred: PopupPlacement,
  anchor: AnchorRect,
  popup: PopupSize,
  gap: number,
  vw: number,
  vh: number,
): Position {
  const flipMap: Partial<Record<PopupPlacement, PopupPlacement>> = {
    'bottom':       'top',
    'bottom-start': 'top-start',
    'bottom-end':   'top-end',
    'top':          'bottom',
    'top-start':    'bottom-start',
    'top-end':      'bottom-end',
    'left':         'right',
    'left-start':   'right-start',
    'left-end':     'right-end',
    'right':        'left',
    'right-start':  'left-start',
    'right-end':    'left-end',
  };

  let placement = preferred;
  let pos = rawPosition(placement, anchor, popup, gap);

  // Flip if overflowing on the preferred side
  const overflowRight = (placement === 'right' || placement === 'right-start' || placement === 'right-end') && pos.left + popup.pw > vw;
  const overflowLeft = (placement === 'left' || placement === 'left-start' || placement === 'left-end') && pos.left < 0;
  const needsFlip =
    (placement.startsWith('bottom') && pos.top + popup.ph > vh) ||
    (placement.startsWith('top')    && pos.top < 0) ||
    overflowLeft ||
    overflowRight;

  if (needsFlip && flipMap[placement]) {
    const flipped = flipMap[placement]!;
    const flippedPos = rawPosition(flipped, anchor, popup, gap);
    // Only use the flipped position if it actually fits better
    const flippedOk =
      (flipped.startsWith('bottom') ? flippedPos.top + popup.ph <= vh : true) &&
      (flipped.startsWith('top')    ? flippedPos.top >= 0 : true) &&
      ((flipped === 'left' || flipped === 'left-start' || flipped === 'left-end') ? flippedPos.left >= 0 : true) &&
      ((flipped === 'right' || flipped === 'right-start' || flipped === 'right-end') ? flippedPos.left + popup.pw <= vw : true);
    if (flippedOk) {
      placement = flipped;
      pos = flippedPos;
    }
  }

  // Clamp both axes within viewport
  return {
    top:  clamp(pos.top,  EDGE_PAD, Math.max(EDGE_PAD, vh - popup.ph - EDGE_PAD)),
    left: clamp(pos.left, EDGE_PAD, Math.max(EDGE_PAD, vw - popup.pw - EDGE_PAD)),
  };
}

// ---------------------------------------------------------------------------
// Web implementation
// ---------------------------------------------------------------------------

function PopupPortalWeb({
  anchorRef,
  open,
  onClose,
  placement = 'bottom-start',
  gap = 6,
  interactive = true,
  sameWidth = false,
  children,
  style,
}: PopupPortalProps) {
  const popupRef = useRef<HTMLDivElement>(null);

  // { ax, ay, aw, ah } measured from the anchor in fixed coords
  const [anchor, setAnchor] = useState<AnchorRect | null>(null);
  // Final computed position (null = still in hidden first-pass)
  const [pos, setPos] = useState<Position | null>(null);

  // Measure anchor whenever open changes to true
  const measureAnchor = useCallback(() => {
    anchorRef.current?.measureInWindow((x, y, w, h) => {
      setAnchor({ ax: x, ay: y, aw: w, ah: h });
    });
  }, [anchorRef]);

  useEffect(() => {
    if (!open) {
      setAnchor(null);
      setPos(null);
      return;
    }
    measureAnchor();
  }, [open, measureAnchor]);

  // Re-measure anchor on scroll / resize while open
  useEffect(() => {
    if (!open || typeof window === 'undefined') return;
    const handler = () => measureAnchor();
    window.addEventListener('scroll', handler, { capture: true, passive: true });
    window.addEventListener('resize', handler, { passive: true });
    return () => {
      window.removeEventListener('scroll', handler, true);
      window.removeEventListener('resize', handler);
    };
  }, [open, measureAnchor]);

  // Two-pass positioning: after anchor is known + popup is rendered,
  // measure popup and compute final position synchronously before paint.
  useLayoutEffect(() => {
    if (!open || !anchor || !popupRef.current) return;
    const el = popupRef.current;
    const pw = el.offsetWidth;
    const ph = el.offsetHeight;
    if (!pw && !ph) return; // not yet sized
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const finalPos = computePosition(placement, anchor, { pw, ph }, gap, vw, vh);
    setPos(finalPos);
  }, [open, anchor, placement, gap]);

  // Close on click outside
  useEffect(() => {
    if (!open || typeof document === 'undefined') return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node | null;
      const popupEl = popupRef.current;
      const anchorEl = anchorRef.current as unknown as Node | null;
      if (
        target &&
        popupEl && !popupEl.contains(target) &&
        anchorEl && !anchorEl.contains(target)
      ) {
        onClose?.();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, onClose, anchorRef]);

  // Close on Escape
  useEffect(() => {
    if (!open || typeof document === 'undefined') return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  const { createPortal } = require('react-dom');

  // First pass: render off-screen + hidden so we can measure
  const popupStyle: React.CSSProperties = pos
    ? {
        position: 'fixed',
        top: pos.top,
        left: pos.left,
        zIndex: 99999,
        pointerEvents: interactive ? 'auto' : 'none',
        ...(sameWidth && anchor ? { minWidth: anchor.aw } : {}),
        ...(style as React.CSSProperties | undefined),
      }
    : {
        position: 'fixed',
        top: -9999,
        left: -9999,
        visibility: 'hidden',
        zIndex: 99999,
        pointerEvents: 'none',
        ...(sameWidth && anchor ? { minWidth: anchor.aw } : {}),
        ...(style as React.CSSProperties | undefined),
      };

  return createPortal(
    <div ref={popupRef} style={popupStyle}>
      {children}
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// Native implementation (transparent full-screen Modal)
// ---------------------------------------------------------------------------

function PopupPortalNative({
  anchorRef,
  open,
  onClose,
  placement = 'bottom-start',
  gap = 6,
  sameWidth = false,
  children,
  style,
}: PopupPortalProps) {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const [anchor, setAnchor] = useState<AnchorRect | null>(null);
  // Popup size measured via onLayout
  const [popupSize, setPopupSize] = useState<PopupSize | null>(null);

  useEffect(() => {
    if (!open) {
      setAnchor(null);
      setPopupSize(null);
      return;
    }
    anchorRef.current?.measureInWindow((x, y, w, h) => {
      setAnchor({ ax: x, ay: y, aw: w, ah: h });
    });
  }, [open, anchorRef]);

  const pos =
    anchor && popupSize
      ? computePosition(placement, anchor, popupSize, gap, screenWidth, screenHeight)
      : null;

  return (
    <Modal visible={open} transparent animationType="none" onRequestClose={onClose}>
      <Pressable style={{ flex: 1 }} onPress={onClose}>
        {anchor && (
          <Pressable
            onPress={(e) => e?.stopPropagation?.()}
            onLayout={(e) => {
              const { width, height } = e.nativeEvent.layout;
              setPopupSize({ pw: width, ph: height });
            }}
            style={[
              {
                position: 'absolute',
                // Use computed position once available, otherwise hide off-screen
                top: pos ? pos.top : -9999,
                left: pos ? pos.left : -9999,
                ...(sameWidth ? { minWidth: anchor.aw } : {}),
              },
              style,
            ]}
          >
            {children}
          </Pressable>
        )}
      </Pressable>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Public export — picks the right implementation per platform
// ---------------------------------------------------------------------------

export function PopupPortal(props: PopupPortalProps) {
  if (Platform.OS === 'web') {
    return <PopupPortalWeb {...props} />;
  }
  return <PopupPortalNative {...props} />;
}
