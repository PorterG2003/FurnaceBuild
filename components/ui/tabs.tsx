import { useState, useEffect, useRef, useMemo } from 'react';
import { View, Text, TouchableOpacity, LayoutChangeEvent, Animated, PixelRatio, Platform } from 'react-native';

export interface Tab {
  id: string;
  label: string;
}

/** `brand` = orange indicator (default). `indigo` = Flux-style muted indigo pill behind the active tab. */
export type TabsColor = 'brand' | 'indigo';

interface TabsProps {
  tabs: Tab[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
  /**
   * - content: tabs size to their label (variable widths). Container shrink-wraps up to max width.
   * - equal: tabs share available width equally (full-width).
   */
  layout?: 'content' | 'equal';
  /** Bottom margin of the tab bar. Default 16. Use 0 for tight layouts (e.g. mobile modals). */
  marginBottom?: number;
  textSize?: number;
  /** Tighter padding (e.g. Flux editor panel). */
  compact?: boolean;
  /** Visual variant for indicator and label contrast. Default matches historical brand orange tabs. */
  color?: TabsColor;
}

const TAB_COLORS: Record<
  TabsColor,
  {
    indicator: string;
    activeLabel: string;
    inactiveLabel: string;
  }
> = {
  brand: {
    indicator: '#f85102',
    activeLabel: '#FFFFFF',
    inactiveLabel: '#9ca3af',
  },
  indigo: {
    indicator: 'rgba(99, 102, 241, 0.25)',
    activeLabel: '#FFFFFF',
    inactiveLabel: '#6b7280',
  },
};

function indicatorShadowStyle(color: TabsColor): Record<string, unknown> {
  if (color === 'indigo') return {};
  if (typeof window !== 'undefined') {
    return { boxShadow: '0px 2px 4px rgba(0,0,0,0.25)' };
  }
  return {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 4,
  };
}

export function Tabs({
  tabs,
  activeTab,
  onTabChange,
  layout = 'content',
  marginBottom = 16,
  textSize = 14,
  compact = false,
  color = 'brand',
}: TabsProps) {
  const palette = TAB_COLORS[color];
  const [containerWidth, setContainerWidth] = useState(0);
  const [tabTextWidths, setTabTextWidths] = useState<Array<number | null>>([]);
  const tabIndicator = useRef(new Animated.Value(0)).current;
  const tabIndicatorWidth = useRef(new Animated.Value(0)).current;

  const BORDER_WIDTH = 1;
  const CONTAINER_PADDING = compact ? 2 : 4;
  const INDICATOR_INSET = compact ? 3 : 4;
  const TAB_HORIZONTAL_PADDING = compact ? 8 : 12;
  const snapPx = (value: number, mode: 'floor' | 'ceil' | 'round' = 'round') => {
    if (Platform.OS === 'web') {
      if (mode === 'floor') return Math.floor(value);
      if (mode === 'ceil') return Math.ceil(value);
      return Math.round(value);
    }
    const r = PixelRatio.get();
    if (mode === 'floor') return Math.floor(value * r) / r;
    if (mode === 'ceil') return Math.ceil(value * r) / r;
    return Math.round(value * r) / r;
  };

  const tabsKey = useMemo(() => tabs.map((t) => t.id).join('|'), [tabs]);

  const activeTabIndex = useMemo(() => {
    const index = tabs.findIndex((tab) => tab.id === activeTab);
    return index === -1 ? 0 : index;
  }, [activeTab, tabs]);

  useEffect(() => {
    Animated.timing(tabIndicator, {
      toValue: activeTabIndex,
      duration: 220,
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  }, [activeTabIndex, tabIndicator]);

  useEffect(() => {
    setTabTextWidths(Array(tabs.length).fill(null));
  }, [tabsKey, tabs.length]);

  // Equal tabs are laid out by flex, so the indicator geometry is derived from the
  // container instead of per-tab measurements: mixing the container border box (x from
  // onLayout) with the padding box (absolute `left`) skews the indicator by the border
  // width, which is visible on narrow tab bars.
  const equalTabWidth = useMemo(() => {
    if (layout !== 'equal' || tabs.length === 0) return null;
    const inner = containerWidth - (CONTAINER_PADDING + BORDER_WIDTH) * 2;
    if (inner <= 0) return null;
    return inner / tabs.length;
  }, [BORDER_WIDTH, CONTAINER_PADDING, containerWidth, layout, tabs.length]);

  const computedTabWidths = useMemo(() => {
    if (layout !== 'content') return null;
    if (tabTextWidths.length !== tabs.length) return null;
    return tabTextWidths.map((w) => {
      if (!w) return null;
      return snapPx(w + TAB_HORIZONTAL_PADDING * 2, 'ceil');
    });
  }, [TAB_HORIZONTAL_PADDING, compact, layout, tabTextWidths, tabs.length]);

  const computedTabPositions = useMemo(() => {
    if (!computedTabWidths) return null;
    let acc = 0;
    return computedTabWidths.map((w) => {
      if (!w) return null;
      const pos = acc;
      acc += w;
      return pos;
    });
  }, [computedTabWidths]);

  const hasMeasurements = useMemo(() => {
    if (layout === 'content') {
      if (!computedTabWidths || !computedTabPositions) return false;
      return computedTabWidths.every((v) => v !== null) && computedTabPositions.every((v) => v !== null);
    }
    return equalTabWidth !== null;
  }, [computedTabPositions, computedTabWidths, equalTabWidth, layout]);

  const fallbackTranslateX = useMemo(() => Animated.multiply(tabIndicator, 0), [tabIndicator]);

  const indicatorTranslateX = useMemo(() => {
    if (hasMeasurements) {
      const positions =
        layout === 'content'
          ? (computedTabPositions as number[]).map((v) => v ?? 0)
          : tabs.map((_, index) => index * (equalTabWidth ?? 0));
      // interpolate() requires outputRange to have at least 2 elements
      const inputRange = tabs.map((_, index) => index);
      const outputRange = positions.length >= 2 ? positions : [positions[0] ?? 0, positions[0] ?? 0];
      const safeInputRange = inputRange.length >= 2 ? inputRange : [0, 1];
      return tabIndicator.interpolate({
        inputRange: safeInputRange,
        outputRange,
      });
    }
    return fallbackTranslateX;
  }, [computedTabPositions, equalTabWidth, fallbackTranslateX, hasMeasurements, layout, tabIndicator, tabs]);

  useEffect(() => {
    const w = layout === 'content' ? computedTabWidths?.[activeTabIndex] ?? null : equalTabWidth;
    if (!w) return;
    Animated.timing(tabIndicatorWidth, {
      toValue: w,
      duration: 220,
      useNativeDriver: false,
    }).start();
  }, [activeTabIndex, computedTabWidths, equalTabWidth, layout, tabIndicatorWidth]);

  const isEqual = layout === 'equal';

  return (
    <View
      onLayout={
        isEqual
          ? (event: LayoutChangeEvent) => setContainerWidth(event.nativeEvent.layout.width)
          : undefined
      }
      style={{
        position: 'relative',
        flexDirection: 'row',
        backgroundColor: '#1A1A1A',
        borderRadius: 12,
        borderWidth: BORDER_WIDTH,
        borderColor: '#2A2A2A',
        padding: CONTAINER_PADDING,
        marginBottom,
        ...(isEqual
          ? { width: '100%', alignSelf: 'stretch' as const }
          : { alignSelf: 'flex-start' as const, maxWidth: '100%', flexShrink: 1 }),
        overflow: 'hidden',
      }}
    >
      {hasMeasurements && (
        <Animated.View
          style={{
            position: 'absolute',
            left: CONTAINER_PADDING,
            pointerEvents: 'none',
            top: INDICATOR_INSET,
            bottom: INDICATOR_INSET,
            borderRadius: 8,
            backgroundColor: palette.indicator,
            width: tabIndicatorWidth,
            transform: [{ translateX: indicatorTranslateX }],
            ...indicatorShadowStyle(color),
          }}
        />
      )}

      {tabs.map((tab, index) => {
        const isActive = activeTab === tab.id;
        const contentWidth = layout === 'content' ? computedTabWidths?.[index] ?? null : null;
        return (
          <TouchableOpacity
            key={tab.id}
            onPress={() => onTabChange(tab.id)}
            activeOpacity={0.85}
            style={{
              ...(isEqual ? { flex: 1 } : { flexGrow: 0, flexShrink: 0 }),
              ...(layout === 'content' && contentWidth ? { width: contentWidth } : null),
              alignItems: 'center',
              justifyContent: 'center',
              paddingVertical: compact ? 6 : 8,
              paddingHorizontal: isEqual ? TAB_HORIZONTAL_PADDING : 0,
              zIndex: 1,
              ...(color === 'indigo' && isEqual ? { minHeight: compact ? 40 : 44 } : null),
            }}
          >
            <Text
              onLayout={
                layout === 'content'
                  ? (event) => {
                      const w = event.nativeEvent.layout.width;
                      setTabTextWidths((prev) => {
                        const next = prev.length === tabs.length ? [...prev] : Array(tabs.length).fill(null);
                        next[index] = w;
                        return next;
                      });
                    }
                  : undefined
              }
              style={{
                color: isActive ? palette.activeLabel : palette.inactiveLabel,
                fontSize: textSize,
                fontFamily: 'Instrument Sans, system-ui, sans-serif',
                fontWeight: isActive ? '600' : '500',
              }}
            >
              {tab.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}
