import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, useWindowDimensions } from 'react-native';
import { BarChart, type barDataItem } from 'react-native-gifted-charts';
import type { CampaignStatsByDay } from '@/lib/supabase/services/campaigns';
import { format, parseISO } from 'date-fns';

const CHART_HEIGHT = 220;
const COLORS = {
  sent: '#a78bfa',
  replied: '#14b8a6',
  positiveReply: '#10b981',
  bounce: '#f59e0b',
};
const BAR_LABELS = ['Sent', 'Replied', 'Positive', 'Bounced'] as const;
type BarLabelType = (typeof BAR_LABELS)[number];
const GROUP_BAR_WIDTH = 14;
const BAR_SPACING = 4;
const GROUP_SPACING = 16;
const BAR_ANIMATION_DURATION = 700;
const FONT_FAMILY = 'InstrumentSans_400Regular';
const FONT_FAMILY_SEMIBOLD = 'InstrumentSans_600SemiBold';

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

interface CampaignStatsChartProps {
  data: CampaignStatsByDay[];
  loading?: boolean;
  /** When true, omit outer card styling (for use inside another card) */
  embedded?: boolean;
}

export function CampaignStatsChart({ data, loading, embedded }: CampaignStatsChartProps) {
  const progress = useBarGrowAnimation(!!data && data.length > 0);

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

  const { width: windowWidth } = useWindowDimensions();
  const chartParentWidth = windowWidth - 24 * 2 - 16 * 2;

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
        dataLabel: v.type,
        date: day.date,
        spacing: i === 3 ? GROUP_SPACING : BAR_SPACING,
        barWidth: GROUP_BAR_WIDTH,
        labelTextStyle: {
          color: '#9CA3AF',
          fontSize: 10,
          fontFamily: FONT_FAMILY,
        },
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

  const renderTooltip = useCallback((item: BarItem) => {
    if (!item) return null;
    const barItem = item as BarItem;
    return (
      <View
        style={{
          backgroundColor: '#2A2A2A',
          borderWidth: 1,
          borderColor: '#3A3A3A',
          borderRadius: 8,
          paddingVertical: 10,
          paddingHorizontal: 12,
          minWidth: 100,
        }}
      >
        <Text style={{ color: '#9CA3AF', fontSize: 11, marginBottom: 4, fontFamily: FONT_FAMILY }}>
          {barItem.date ? format(parseISO(barItem.date), 'MMM d, yyyy') : ''}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View
              style={{
                width: 8,
                height: 8,
                borderRadius: 2,
                backgroundColor: (barItem.frontColor as string) ?? '#9CA3AF',
              }}
            />
            <Text style={{ color: '#D1D5DB', fontSize: 12, fontFamily: FONT_FAMILY }}>
              {barItem.dataLabel ?? ''}
            </Text>
          </View>
          <Text style={{ color: '#fff', fontSize: 12, fontFamily: FONT_FAMILY }}>
            {barItem.value ?? 0}
          </Text>
        </View>
      </View>
    );
  }, []);

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
        <BarChart
        data={barData}
        width={chartParentWidth}
        height={CHART_HEIGHT}
        maxValue={maxValue}
        noOfSections={4}
        barWidth={GROUP_BAR_WIDTH}
        spacing={BAR_SPACING}
        initialSpacing={16}
        endSpacing={16}
        xAxisThickness={1}
        xAxisColor="#2A2A2A"
        yAxisThickness={0}
        yAxisTextStyle={{ color: '#9CA3AF', fontSize: 11, fontFamily: FONT_FAMILY }}
        xAxisLabelTextStyle={{ color: '#9CA3AF', fontSize: 10, fontFamily: FONT_FAMILY }}
        labelsDistanceFromXaxis={8}
        hideRules={false}
        rulesColor="#2A2A2A"
        rulesThickness={1}
        disableScroll={false}
        showScrollIndicator={false}
        scrollToEnd
        roundedTop
        roundedBottom={false}
        backgroundColor="transparent"
        isAnimated={false}
        renderTooltip={renderTooltip}
        autoCenterTooltip
      />
      </View>
    </View>
  );
}
