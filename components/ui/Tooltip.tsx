import { useState, useRef, useLayoutEffect, type ReactNode, type CSSProperties } from 'react';
import { View, Pressable, Platform, type StyleProp, type ViewStyle } from 'react-native';

export type TooltipPlacement = 'top' | 'bottom' | 'left' | 'right';

interface TooltipProps {
  content: ReactNode;
  placement?: TooltipPlacement;
  children: ReactNode;
  /** Optional style for the wrapper (position: relative). */
  style?: StyleProp<ViewStyle>;
}

const GAP = 6;

const TOOLTIP_PANEL_STYLE = {
  paddingHorizontal: 10,
  paddingVertical: 8,
  borderRadius: 8,
  backgroundColor: '#1A1A1A',
  borderWidth: 1,
  borderColor: '#2A2A2A',
};

/** In-place tooltip styles (used when not using portal, e.g. native). */
const PLACEMENT_STYLES: Record<TooltipPlacement, ViewStyle> = {
  top: {
    position: 'absolute',
    bottom: 36,
    left: 0,
  },
  bottom: {
    position: 'absolute',
    top: 36,
    left: 0,
    marginTop: GAP,
  },
  left: {
    position: 'absolute',
    right: 0,
    top: 0,
    marginRight: GAP,
  },
  right: {
    position: 'absolute',
    left: 40,
    top: 0,
    marginLeft: GAP,
  },
};

const PORTAL_Z_INDEX = 99999;

export function Tooltip({ content, placement = 'top', children, style }: TooltipProps) {
  const [hovered, setHovered] = useState(false);
  const [triggerRect, setTriggerRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const wrapperRef = useRef<View>(null);

  const updatePosition = () => {
    wrapperRef.current?.measureInWindow((x, y, w, h) => {
      setTriggerRect((prev) => {
        if (!prev || prev.x !== x || prev.y !== y || prev.w !== w || prev.h !== h) {
          return { x, y, w, h };
        }
        return prev;
      });
    });
  };

  useLayoutEffect(() => {
    if (!hovered || Platform.OS !== 'web') return;
    updatePosition();
    if (typeof window === 'undefined') return;
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [hovered, Platform.OS]);

  const tooltipPanel = (
    <View style={TOOLTIP_PANEL_STYLE}>
      {content}
    </View>
  );

  const renderTooltipInPortal = () => {
    if (Platform.OS !== 'web' || !triggerRect || typeof document === 'undefined') return null;
    const { createPortal } = require('react-dom');
    const { x, y, w, h } = triggerRect;
    let portalStyle: CSSProperties = {
      position: 'fixed',
      zIndex: PORTAL_Z_INDEX,
      pointerEvents: 'none',
    };
    switch (placement) {
      case 'top':
        portalStyle = { ...portalStyle, top: y - GAP, left: x, transform: 'translateY(-100%)' };
        break;
      case 'bottom':
        portalStyle = { ...portalStyle, top: y + h + GAP, left: x };
        break;
      case 'left':
        portalStyle = { ...portalStyle, top: y, left: x - GAP, transform: 'translateX(-100%)' };
        break;
      case 'right':
        portalStyle = { ...portalStyle, top: y, left: x + w + GAP };
        break;
    }
    return createPortal(
      <div style={portalStyle} data-tooltip-portal>
        {tooltipPanel}
      </div>,
      document.body
    );
  };

  const renderTooltipInPlace = () => (
    <View
      style={[
        PLACEMENT_STYLES[placement],
        {
          zIndex: PORTAL_Z_INDEX,
          ...TOOLTIP_PANEL_STYLE,
        },
      ]}
    >
      {content}
    </View>
  );

  return (
    <View ref={wrapperRef} style={[{ position: 'relative' }, style]}>
      <Pressable
        style={{ flex: 1, minWidth: 0 }}
        onHoverIn={Platform.OS === 'web' ? () => setHovered(true) : undefined}
        onHoverOut={Platform.OS === 'web' ? () => setHovered(false) : undefined}
      >
        {children}
      </Pressable>
      {hovered && (
        Platform.OS === 'web' ? renderTooltipInPortal() : renderTooltipInPlace()
      )}
    </View>
  );
}
