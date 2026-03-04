import { useState, useRef, useLayoutEffect, type ReactNode, type RefObject } from 'react';
import { View, Pressable, Platform, type StyleProp, type ViewStyle, type ViewProps } from 'react-native';
import { PopupPortal, type PopupPlacement } from '@/components/ui/PopupPortal';

export type TooltipPlacement = 'top' | 'bottom' | 'left' | 'right' | 'cursor';

interface TooltipProps {
  content: ReactNode;
  placement?: TooltipPlacement;
  children: ReactNode;
  /** Optional style for the wrapper (position: relative). */
  style?: StyleProp<ViewStyle>;
}

const TOOLTIP_PANEL_STYLE = {
  paddingHorizontal: 10,
  paddingVertical: 8,
  borderRadius: 8,
  backgroundColor: '#1A1A1A',
  borderWidth: 1,
  borderColor: '#2A2A2A',
};

const CURSOR_OFFSET = 12;
const EDGE_PAD = 8;
const PORTAL_Z_INDEX = 99999;

export function Tooltip({ content, placement = 'top', children, style }: TooltipProps) {
  const [hovered, setHovered] = useState(false);
  const [cursorPosition, setCursorPosition] = useState<{ x: number; y: number } | null>(null);
  const wrapperRef = useRef<View>(null);
  // Ref to the cursor-tooltip DOM div so we can measure it for clamping.
  const cursorPopupRef = useRef<HTMLDivElement | null>(null);
  // Clamped position computed after measuring the popup element.
  const [clampedPos, setClampedPos] = useState<{ left: number; top: number } | null>(null);

  const isCursorPlacement = placement === 'cursor';

  const handleMouseMove = isCursorPlacement && Platform.OS === 'web'
    ? (e: { nativeEvent: { clientX?: number; clientY?: number } }) => {
        const { clientX, clientY } = e.nativeEvent;
        if (typeof clientX === 'number' && typeof clientY === 'number') {
          setClampedPos(null); // reset so useLayoutEffect re-clamps after next render
          setCursorPosition({ x: clientX, y: clientY });
        }
      }
    : undefined;
  // For cursor placement we need initial position from the enter event so the tooltip shows
  // without requiring a mouse move (e.g. chart bar strips).
  const handleMouseEnter = Platform.OS === 'web'
    ? (e: { nativeEvent: { clientX?: number; clientY?: number } }) => {
        setHovered(true);
        if (isCursorPlacement) {
          const { clientX, clientY } = e.nativeEvent;
          if (typeof clientX === 'number' && typeof clientY === 'number') {
            setClampedPos(null);
            setCursorPosition({ x: clientX, y: clientY });
          }
        }
      }
    : undefined;
  const handleHoverIn = Platform.OS === 'web' ? () => setHovered(true) : undefined;
  const handleHoverOut = Platform.OS === 'web' ? () => {
    setHovered(false);
    if (isCursorPlacement) {
      setCursorPosition(null);
      setClampedPos(null);
    }
  } : undefined;

  // After cursor position changes, measure the rendered popup and clamp it inside the viewport.
  useLayoutEffect(() => {
    if (Platform.OS !== 'web' || !cursorPosition || !cursorPopupRef.current) return;
    const el = cursorPopupRef.current;
    const pw = el.offsetWidth;
    const ph = el.offsetHeight;
    if (!pw && !ph) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const rawLeft = cursorPosition.x + CURSOR_OFFSET;
    const rawTop  = cursorPosition.y + CURSOR_OFFSET;
    setClampedPos({
      left: Math.min(rawLeft, vw - pw - EDGE_PAD),
      top:  Math.min(rawTop,  vh - ph - EDGE_PAD),
    });
  }, [cursorPosition]);

  // Cursor-following tooltip is rendered as a fixed-positioned portal
  // independently of PopupPortal (no anchor measurement needed).
  const renderCursorTooltip = () => {
    if (!hovered || !cursorPosition || typeof document === 'undefined') return null;
    const { createPortal } = require('react-dom');
    // First pass: off-screen + hidden so we can measure. Clamped position applied once available.
    const style: React.CSSProperties = clampedPos
      ? {
          position: 'fixed',
          zIndex: PORTAL_Z_INDEX,
          pointerEvents: 'none',
          left: clampedPos.left,
          top: clampedPos.top,
        }
      : {
          position: 'fixed',
          zIndex: PORTAL_Z_INDEX,
          pointerEvents: 'none',
          left: cursorPosition.x + CURSOR_OFFSET,
          top: cursorPosition.y + CURSOR_OFFSET,
          visibility: 'hidden' as const,
        };
    return createPortal(
      <div ref={cursorPopupRef} style={style}>
        <View style={TOOLTIP_PANEL_STYLE}>{content}</View>
      </div>,
      document.body,
    );
  };

  // Map TooltipPlacement → PopupPlacement (cursor handled separately above)
  const popupPlacement = (isCursorPlacement ? 'top' : placement) as PopupPlacement;

  const webMouseProps =
    Platform.OS === 'web'
      ? ({
          onMouseMove: handleMouseMove,
          onMouseEnter: handleMouseEnter,
          onMouseLeave: handleHoverOut,
        } as ViewProps)
      : {};

  return (
    <View
      ref={wrapperRef}
      style={[{ position: 'relative' }, style]}
      {...webMouseProps}
    >
      <Pressable style={{ flex: 1, minWidth: 0 }} onHoverIn={handleHoverIn} onHoverOut={handleHoverOut}>
        {children}
      </Pressable>

      {/* Cursor tooltip — positioned at mouse coords, no anchor measurement */}
      {isCursorPlacement && Platform.OS === 'web' && renderCursorTooltip()}

      {/* Standard placements — delegate positioning to PopupPortal */}
      {!isCursorPlacement && (
        <PopupPortal
          anchorRef={wrapperRef as RefObject<View>}
          open={hovered}
          placement={popupPlacement}
          gap={6}
          interactive={false}
        >
          <View style={TOOLTIP_PANEL_STYLE}>{content}</View>
        </PopupPortal>
      )}
    </View>
  );
}
