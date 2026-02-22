import { useState, useEffect, useRef, useMemo } from 'react';
import { View, Text, TouchableOpacity, LayoutChangeEvent, Animated, PixelRatio, Platform } from 'react-native';

export interface Tab {
  id: string;
  label: string;
}

interface TabsProps {
  tabs: Tab[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
  /**
   * - content: tabs size to their label (variable widths). Container shrink-wraps up to max width.
   * - equal: tabs share available width equally (full-width).
   */
  layout?: 'content' | 'equal';
}

export function Tabs({ tabs, activeTab, onTabChange, layout = 'content' }: TabsProps) {
  const [tabPositions, setTabPositions] = useState<Array<number | null>>([]);
  const [tabWidths, setTabWidths] = useState<Array<number | null>>([]);
  const [tabTextWidths, setTabTextWidths] = useState<Array<number | null>>([]);
  const tabIndicator = useRef(new Animated.Value(0)).current;
  const tabIndicatorWidth = useRef(new Animated.Value(0)).current;

  const CONTAINER_PADDING = 4;
  const INDICATOR_INSET = 4;
  const TAB_HORIZONTAL_PADDING = 12;
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
      useNativeDriver: true,
    }).start();
  }, [activeTabIndex, tabIndicator]);

  useEffect(() => {
    setTabPositions(Array(tabs.length).fill(null));
    setTabWidths(Array(tabs.length).fill(null));
    setTabTextWidths(Array(tabs.length).fill(null));
  }, [tabsKey, tabs.length]);

  const computedTabWidths = useMemo(() => {
    if (layout !== 'content') return null;
    if (tabTextWidths.length !== tabs.length) return null;
    return tabTextWidths.map((w) => {
      if (!w) return null;
      return snapPx(w + TAB_HORIZONTAL_PADDING * 2, 'ceil');
    });
  }, [TAB_HORIZONTAL_PADDING, layout, tabTextWidths, tabs.length]);

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
    if (tabPositions.length !== tabs.length || tabWidths.length !== tabs.length) return false;
    return tabPositions.every((v) => v !== null) && tabWidths.every((v) => v !== null);
  }, [computedTabPositions, computedTabWidths, layout, tabPositions, tabWidths, tabs.length]);

  const fallbackTranslateX = useMemo(() => Animated.multiply(tabIndicator, 0), [tabIndicator]);

  const indicatorTranslateX = useMemo(() => {
    if (hasMeasurements) {
      return tabIndicator.interpolate({
        inputRange: tabs.map((_, index) => index),
        outputRange:
          layout === 'content'
            ? (computedTabPositions as number[]).map((v) => v ?? 0)
            : (tabPositions as number[]).map((v) => v ?? 0),
      });
    }
    return fallbackTranslateX;
  }, [computedTabPositions, fallbackTranslateX, hasMeasurements, layout, tabIndicator, tabPositions, tabs]);

  useEffect(() => {
    const w =
      layout === 'content'
        ? computedTabWidths?.[activeTabIndex] ?? null
        : tabWidths[activeTabIndex];
    if (!w) return;
    Animated.timing(tabIndicatorWidth, {
      toValue: w,
      duration: 220,
      useNativeDriver: false,
    }).start();
  }, [activeTabIndex, computedTabWidths, layout, tabIndicatorWidth, tabWidths]);

  const isEqual = layout === 'equal';

  return (
    <View
      style={{
        position: 'relative',
        flexDirection: 'row',
        backgroundColor: '#1A1A1A',
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#2A2A2A',
        padding: CONTAINER_PADDING,
        marginBottom: 16,
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
            backgroundColor: '#f85102',
            width: tabIndicatorWidth,
            transform: [{ translateX: indicatorTranslateX }],
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.25,
            shadowRadius: 4,
            elevation: 4,
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
            onLayout={
              isEqual
                ? (event: LayoutChangeEvent) => {
                    const { width, x } = event.nativeEvent.layout;
                    setTabPositions((prev) => {
                      const next = prev.length === tabs.length ? [...prev] : Array(tabs.length).fill(null);
                      next[index] = snapPx(Math.max(0, x - CONTAINER_PADDING), 'round');
                      return next;
                    });
                    setTabWidths((prev) => {
                      const next = prev.length === tabs.length ? [...prev] : Array(tabs.length).fill(null);
                      next[index] = snapPx(width, 'ceil');
                      return next;
                    });
                  }
                : undefined
            }
            style={{
              ...(isEqual ? { flex: 1 } : { flexGrow: 0, flexShrink: 0 }),
              ...(layout === 'content' && contentWidth ? { width: contentWidth } : null),
              alignItems: 'center',
              justifyContent: 'center',
              paddingVertical: 8,
              paddingHorizontal: isEqual ? TAB_HORIZONTAL_PADDING : 0,
              zIndex: 1,
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
                color: isActive ? '#FFFFFF' : '#9ca3af',
                fontSize: 14,
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
