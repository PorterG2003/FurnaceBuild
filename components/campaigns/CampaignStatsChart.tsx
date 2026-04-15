import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Platform, ScrollView, useWindowDimensions, type NativeSyntheticEvent, type NativeScrollEvent } from 'react-native';
import { BarChart, type barDataItem } from 'react-native-gifted-charts';
import type { CampaignStatsByDay } from '@/lib/supabase/services/campaigns';
import { CAMPAIGN_STAT_COLORS } from '@/lib/campaigns/campaignStatColors';
import { format, parseISO } from 'date-fns';
import { Tooltip } from '@/components/ui/Tooltip';

const CHART_HEIGHT = 220;
/** Extra space below chart so x-axis labels with descenders (e.g. "Aug", "Sep") are not clipped */
const CHART_X_LABEL_PADDING_BOTTOM = 14;
const COLORS = CAMPAIGN_STAT_COLORS;
const BAR_LABELS = ['Sent', 'Replied', 'Positive', 'Bounced'] as const;
type BarLabelType = (typeof BAR_LABELS)[number];
const GROUP_BAR_WIDTH = 14;
const BAR_SPACING = 4;
const GROUP_SPACING = 16;
const GROUP_LABEL_WIDTH = 4 * GROUP_BAR_WIDTH + 3 * BAR_SPACING;
const BAR_ANIMATION_DURATION = 700;
const FONT_FAMILY = 'InstrumentSans_400Regular';
const FONT_FAMILY_SEMIBOLD = 'InstrumentSans_600SemiBold';
const INITIAL_SPACING = 16;
const END_SPACING = 16;
const Y_AXIS_LABEL_WIDTH = 35;
const GROUP_WIDTH = 4 * GROUP_BAR_WIDTH + 3 * BAR_SPACING + GROUP_SPACING;
const STRIP_WIDTH = 4 * GROUP_BAR_WIDTH + 3 * BAR_SPACING;

interface BarItem extends barDataItem {
  value: number;
  dataLabel: BarLabelType;
  date: string;
}

function useBarGrowAnimation(hasData: boolean) {
  const [progress, setProgress] = useState(0);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!hasData || startedRef.current) return;
    startedRef.current = true;
    const startTime = performance.now();
    const tick = () => {
      const elapsed = performance.now() - startTime;
      const t = Math.min(1, elapsed / BAR_ANIMATION_DURATION);
      setProgress(t);
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [hasData]);

  return progress;
}

function getNiceMax(value: number): number {
  if (value <= 10) return 10;
  if (value <= 50) return Math.ceil(value / 5) * 5;
  if (value <= 100) return Math.ceil(value / 10) * 10;
  return Math.ceil(value / 25) * 25;
}

const STAT_DEFS = [
  { label: 'Sent', key: 'sent' as const, color: COLORS.sent },
  { label: 'Replied', key: 'replied' as const, color: COLORS.replied },
  { label: 'Positive', key: 'positiveReply' as const, color: COLORS.positiveReply },
  { label: 'Bounced', key: 'bounce' as const, color: COLORS.bounce },
];

function DayTooltipContent({ day }: { day: CampaignStatsByDay }) {
  return (
    <>
      <Text style={{ color: '#9CA3AF', fontSize: 11, marginBottom: 4, fontFamily: FONT_FAMILY }}>
        {format(parseISO(day.date), 'MMM d, yyyy')}
      </Text>
      {STAT_DEFS.map((stat) => (
        <View key={stat.label} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: stat.color }} />
            <Text style={{ color: '#D1D5DB', fontSize: 12, fontFamily: FONT_FAMILY }}>{stat.label}</Text>
          </View>
          <Text style={{ color: '#fff', fontSize: 12, fontFamily: FONT_FAMILY }}>{day[stat.key]}</Text>
        </View>
      ))}
    </>
  );
}

interface CampaignStatsChartProps {
  data: CampaignStatsByDay[];
  loading?: boolean;
  /** When true, omit outer card styling (for use inside another card) */
  embedded?: boolean;
  /** Optional width for chart container (e.g. from parent onLayout). When provided, avoids double-subtraction of padding on narrow screens. */
  containerWidth?: number;
}

export function CampaignStatsChart({ data, loading, embedded, containerWidth: containerWidthProp }: CampaignStatsChartProps) {
  const progress = useBarGrowAnimation(!!data && data.length > 0);
  const [scrollX, setScrollX] = useState(0);
  const [measuredWidth, setMeasuredWidth] = useState<number | null>(null);
  const { width: windowWidth } = useWindowDimensions();

  const chartParentWidth =
    containerWidthProp ?? measuredWidth ?? Math.max(280, windowWidth - 24 * 2 - 16 * 2);

  const handleScroll = useCallback((ev: NativeSyntheticEvent<NativeScrollEvent>) => {
    setScrollX(ev.nativeEvent.contentOffset.x);
  }, []);

  const tooltipStrips = useMemo(
    () =>
      data && data.length > 0
        ? data.map((day, i) => (
            <Tooltip
              key={day.date}
              content={<DayTooltipContent day={day} />}
              placement="cursor"
              style={{
                position: 'absolute',
                left: INITIAL_SPACING + i * GROUP_WIDTH,
                width: GROUP_WIDTH,
                top: 0,
                bottom: 0,
              }}
            >
              <View style={{ flex: 1 }} />
            </Tooltip>
          ))
        : null,
    [data]
  );

  const wrapperStyle = { width: '100%' as const };
  const wrapperClass = embedded ? undefined : 'rounded-xl border border-[#2A2A2A] bg-[#1A1A1A]';
  const innerClass = embedded ? undefined : 'p-4';

  if (loading) {
    return (
      <View className={wrapperClass} style={wrapperStyle}>
        <View className={innerClass} style={embedded ? { paddingVertical: 24 } : undefined}>
          <Text className="text-gray-400 font-instrument text-sm">Loading chart...</Text>
        </View>
      </View>
    );
  }

  if (!data || data.length === 0) {
    return (
      <View className={wrapperClass} style={wrapperStyle}>
        <View className={innerClass} style={embedded ? { paddingVertical: 24 } : undefined}>
          <Text className="text-gray-400 font-instrument text-sm">No activity in this range yet.</Text>
        </View>
      </View>
    );
  }

  const maxSingle = Math.max(
    1,
    ...data.flatMap((d) => [d.sent, d.replied, d.positiveReply, d.bounce])
  );
  const maxValue = getNiceMax(maxSingle);

  const chartContentWidth = INITIAL_SPACING + data.length * GROUP_WIDTH + END_SPACING;

  const barData: BarItem[] = [];
  data.forEach((day) => {
    const dateLabel = format(parseISO(day.date), 'MMM d');
    const values: { value: number; type: BarLabelType; color: string }[] = [
      { value: day.sent * progress, type: 'Sent', color: COLORS.sent },
      { value: day.replied * progress, type: 'Replied', color: COLORS.replied },
      { value: day.positiveReply * progress, type: 'Positive', color: COLORS.positiveReply },
      { value: day.bounce * progress, type: 'Bounced', color: COLORS.bounce },
    ];
    values.forEach((v, i) => {
      barData.push({
        value: v.value,
        frontColor: v.color,
        label: i === 0 ? dateLabel : '',
        labelWidth: i === 0 ? GROUP_LABEL_WIDTH - BAR_SPACING : 0,
        labelComponent: i === 0 ? undefined : () => null,
        dataLabel: v.type,
        date: day.date,
        spacing: i === 3 ? GROUP_SPACING : BAR_SPACING,
        barWidth: GROUP_BAR_WIDTH,
        labelTextStyle: i === 0 ? {
          color: '#9CA3AF',
          fontSize: 10,
          fontFamily: FONT_FAMILY,
        } : undefined,
        topLabelComponent:
          v.value > 0
            ? () => (
                <View style={{ marginTop: 20 }}>
                  <Text
                    style={{
                      color: v.color,
                      fontSize: 10,
                      fontFamily: FONT_FAMILY_SEMIBOLD,
                    }}
                  >
                    {Math.round(v.value)}
                  </Text>
                </View>
              )
            : undefined,
      });
    });
  });

  return (
    <View className={wrapperClass} style={wrapperStyle}>
      <View className={innerClass}>
        <View style={{ flexDirection: 'row', marginBottom: 12, gap: 16, flexWrap: 'wrap' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: COLORS.sent }} />
            <Text className="text-gray-400 font-instrument text-xs">Sent</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: COLORS.replied }} />
            <Text className="text-gray-400 font-instrument text-xs">Replied</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: COLORS.positiveReply }} />
            <Text className="text-gray-400 font-instrument text-xs">Positive</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: COLORS.bounce }} />
            <Text className="text-gray-400 font-instrument text-xs">Bounced</Text>
          </View>
        </View>
        <View
          style={{ position: 'relative' }}
          onLayout={(e) => {
            const w = e.nativeEvent.layout.width;
            if (w > 0) setMeasuredWidth(w);
          }}
        >
          {Platform.OS === 'web' ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={true}
              onScroll={handleScroll}
              scrollEventThrottle={16}
              style={{
                width: chartParentWidth,
                // Prevent browser back/forward on horizontal swipe at scroll edges; allow normal scroll
                overscrollBehaviorX: 'contain' as const,
              }}
              contentContainerStyle={{ width: chartContentWidth }}
            >
              <View style={{ width: chartContentWidth, paddingBottom: CHART_X_LABEL_PADDING_BOTTOM }}>
                <BarChart
                  data={barData}
                  width={chartContentWidth}
                  height={CHART_HEIGHT}
                  maxValue={maxValue}
                  noOfSections={4}
                  barWidth={GROUP_BAR_WIDTH}
                  spacing={BAR_SPACING}
                  initialSpacing={INITIAL_SPACING}
                  endSpacing={END_SPACING}
                  xAxisThickness={1}
                  xAxisColor="#2A2A2A"
                  yAxisThickness={0}
                  yAxisLabelWidth={Y_AXIS_LABEL_WIDTH}
                  yAxisTextStyle={{ color: '#9CA3AF', fontSize: 11, fontFamily: FONT_FAMILY }}
                  xAxisLabelTextStyle={{ color: '#9CA3AF', fontSize: 10, fontFamily: FONT_FAMILY }}
                  labelsDistanceFromXaxis={8}
                  hideRules={false}
                  rulesColor="#2A2A2A"
                  rulesThickness={1}
                  disableScroll={true}
                  showScrollIndicator={false}
                  scrollToEnd={false}
                  roundedBottom={false}
                  barBorderTopLeftRadius={2}
                  barBorderTopRightRadius={2}
                  backgroundColor="transparent"
                  isAnimated={false}
                />
                <View
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: Y_AXIS_LABEL_WIDTH,
                    right: 0,
                    bottom: 0,
                    width: chartContentWidth - Y_AXIS_LABEL_WIDTH,
                  }}
                  pointerEvents="box-none"
                >
                  <View style={{ flex: 1, width: chartContentWidth - Y_AXIS_LABEL_WIDTH }} pointerEvents="box-none">
                    {tooltipStrips}
                  </View>
                </View>
              </View>
            </ScrollView>
          ) : (
            <View style={{ paddingBottom: CHART_X_LABEL_PADDING_BOTTOM }}>
              <BarChart
                data={barData}
                width={chartParentWidth}
                height={CHART_HEIGHT}
                maxValue={maxValue}
                noOfSections={4}
                barWidth={GROUP_BAR_WIDTH}
                spacing={BAR_SPACING}
                initialSpacing={INITIAL_SPACING}
                endSpacing={END_SPACING}
                xAxisThickness={1}
                xAxisColor="#2A2A2A"
                yAxisThickness={0}
                yAxisLabelWidth={Y_AXIS_LABEL_WIDTH}
                yAxisTextStyle={{ color: '#9CA3AF', fontSize: 11, fontFamily: FONT_FAMILY }}
                xAxisLabelTextStyle={{ color: '#9CA3AF', fontSize: 10, fontFamily: FONT_FAMILY }}
                labelsDistanceFromXaxis={8}
                hideRules={false}
                rulesColor="#2A2A2A"
                rulesThickness={1}
                disableScroll={false}
                showScrollIndicator={false}
                scrollToEnd
                roundedBottom={false}
                barBorderTopLeftRadius={2}
                barBorderTopRightRadius={2}
                backgroundColor="transparent"
                isAnimated={false}
                onScroll={handleScroll}
              />
              <View
                style={{
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  left: Y_AXIS_LABEL_WIDTH,
                  right: 0,
                  overflow: 'hidden',
                }}
                pointerEvents="box-none"
              >
                <View
                  style={{
                    position: 'absolute',
                    top: 0,
                    bottom: 0,
                    transform: [{ translateX: -scrollX }],
                    width: chartContentWidth,
                  }}
                  pointerEvents="box-none"
                >
                  {tooltipStrips}
                </View>
              </View>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}
