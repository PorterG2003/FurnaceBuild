import { useId, useMemo, useState } from 'react';
import { View, Text, Platform, ScrollView, useWindowDimensions, type ViewProps, type ViewStyle } from 'react-native';
import { ChartBarIcon, PresentationChartLineIcon } from 'react-native-heroicons/outline';
import { BarChart, CurveType, LineChart } from 'react-native-gifted-charts';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { Tooltip } from '@/components/ui/Tooltip';
import { IconButton } from '@/components/ui/icon-button';
import { CAMPAIGN_STAT_COLORS } from '@/lib/campaigns/campaignStatColors';
import { StickyChartYAxis } from '@/components/campaigns/StickyChartYAxis';

const CHART_HEIGHT = 220;
const CHART_X_LABEL_PADDING_BOTTOM = 14;
const PANEL_GAP = 16;
const FONT_FAMILY = 'InstrumentSans_400Regular';
const FONT_FAMILY_SEMIBOLD = 'InstrumentSans_600SemiBold';
const INITIAL_SPACING = 16;
const END_SPACING = 24;
const Y_AXIS_LABEL_WIDTH = 48;
const MIN_POINT_SPACING = 56;
/** 10px semibold "9999" — two of these must fit on adjacent bars. */
const MIN_FOUR_DIGIT_LABEL_WIDTH = 28;
const BAR_WIDTH = MIN_FOUR_DIGIT_LABEL_WIDTH;
const BAR_INTRA_GAP = 4;
const BAR_GROUP_GAP = 16;
const Y_AXIS_SECTIONS = 4;
const ACTIVE_CHART_KIND_COLOR = '#FFFFFF';
const INACTIVE_CHART_KIND_COLOR = '#9CA3AF';
/** Wash under solid series: same hue, lighter than the stroke. */
const AREA_FILL_START_OPACITY = 0.22;
const AREA_FILL_END_OPACITY = 0.06;
/** Gifted-charts default: `yAxisExtraHeight` is height/20 unless trimmed. */
const Y_AXIS_EXTRA_TOP = CHART_HEIGHT / 20;
const PLOT_BOTTOM = Y_AXIS_EXTRA_TOP + CHART_HEIGHT;

export type TrendSeries = {
  name: string;
  color: string;
  data: number[];
  dashed?: boolean;
};

export type TrendPanel = {
  series: TrendSeries[];
};

export type AccountTrendChartProps = {
  categories: string[];
  panels: TrendPanel[];
  loading?: boolean;
  caption?: string;
  title?: string;
  /** Tooltip heading: day label vs "Week of …". */
  categoryKind?: 'day' | 'week';
};

/** Round the top of the scale so Y-axis ticks are even and match the plotted values. */
function getNiceMax(value: number, sections: number = Y_AXIS_SECTIONS): number {
  const peak = Math.max(value, 1);
  const roughStep = peak / sections;
  const mag = Math.pow(10, Math.floor(Math.log10(roughStep)));
  const residual = roughStep / mag;
  const niceResidual =
    residual <= 1 ? 1 : residual <= 2 ? 2 : residual <= 2.5 ? 2.5 : residual <= 5 ? 5 : 10;
  return niceResidual * mag * sections;
}

function formatChartNumber(n: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(n);
}

/** Matches gifted-charts `svgQuadraticCurvePath` so the fill sits on the line. */
function quadraticLinePath(points: Array<[number, number]>): string {
  if (points.length === 0) return '';
  let path = `M${points[0][0]},${points[0][1]}`;
  for (let i = 0; i < points.length - 1; i++) {
    const xMid = (points[i][0] + points[i + 1][0]) / 2;
    const yMid = (points[i][1] + points[i + 1][1]) / 2;
    const cpX1 = (xMid + points[i][0]) / 2;
    const cpX2 = (xMid + points[i + 1][0]) / 2;
    path += ` Q ${cpX1},${points[i][1]}, ${xMid},${yMid} Q${cpX2},${points[i + 1][1]}, ${points[i + 1][0]},${points[i + 1][1]}`;
  }
  return path;
}

function areaFillPath(points: Array<[number, number]>, bottomY: number): string {
  if (points.length < 2) return '';
  const last = points[points.length - 1];
  const first = points[0];
  return `${quadraticLinePath(points)} L${last[0]},${bottomY} L${first[0]},${bottomY} Z`;
}

function formatYAxisLabel(label: string): string {
  const n = Number(label);
  if (!Number.isFinite(n)) return label;
  if (n >= 1000) {
    const thousands = n / 1000;
    return `${thousands >= 10 ? Math.round(thousands) : Math.round(thousands * 10) / 10}k`;
  }
  if (Number.isInteger(n)) return String(n);
  return String(Math.round(n * 10) / 10);
}

function fallbackPanelHeight(isLast: boolean): number {
  return Y_AXIS_EXTRA_TOP + CHART_HEIGHT + (isLast ? CHART_X_LABEL_PADDING_BOTTOM : 0);
}

function ChartKindToggle({
  chartKind,
  onChange,
}: {
  chartKind: 'line' | 'bar';
  onChange: (kind: 'line' | 'bar') => void;
}) {
  const lineColor = chartKind === 'line' ? ACTIVE_CHART_KIND_COLOR : INACTIVE_CHART_KIND_COLOR;
  const barColor = chartKind === 'bar' ? ACTIVE_CHART_KIND_COLOR : INACTIVE_CHART_KIND_COLOR;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <IconButton
        icon={({ size }) => <PresentationChartLineIcon size={size} color={lineColor} />}
        variant="ghost"
        size="sm"
        accessibilityLabel="Line chart"
        accessibilityState={{ selected: chartKind === 'line' }}
        onPress={() => onChange('line')}
      />
      <IconButton
        icon={({ size }) => <ChartBarIcon size={size} color={barColor} />}
        variant="ghost"
        size="sm"
        accessibilityLabel="Bar chart"
        accessibilityState={{ selected: chartKind === 'bar' }}
        onPress={() => onChange('bar')}
      />
    </View>
  );
}

function PointerTooltip({
  category,
  series,
  index,
  categoryKind,
}: {
  category: string;
  series: TrendSeries[];
  index: number;
  categoryKind: 'day' | 'week';
}) {
  return (
    <>
      <Text style={{ color: '#9CA3AF', fontSize: 11, marginBottom: 4, fontFamily: FONT_FAMILY }}>
        {categoryKind === 'week' ? `Week of ${category}` : category}
      </Text>
      {series.map((s) => (
        <View
          key={s.name}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            marginTop: 2,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: s.color }} />
            <Text style={{ color: '#D1D5DB', fontSize: 12, fontFamily: FONT_FAMILY }}>{s.name}</Text>
          </View>
          <Text style={{ color: '#fff', fontSize: 12, fontFamily: FONT_FAMILY }}>
            {formatChartNumber(s.data[index] ?? 0)}
          </Text>
        </View>
      ))}
    </>
  );
}

function SeriesLegend({ series }: { series: TrendSeries[] }) {
  return (
    <View style={{ flexDirection: 'row', gap: 16, flexWrap: 'wrap', flex: 1 }}>
      {series.map((s) => (
        <View key={s.name} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View
            style={{
              width: s.dashed ? 14 : 10,
              height: s.dashed ? 2 : 10,
              borderRadius: s.dashed ? 0 : 2,
              backgroundColor: s.color,
            }}
          />
          <Text className="text-gray-400 font-instrument text-xs">{s.name}</Text>
        </View>
      ))}
    </View>
  );
}

export function AccountTrendChart({
  categories,
  panels,
  loading,
  caption,
  title,
  categoryKind = 'week',
}: AccountTrendChartProps) {
  const fillIdPrefix = useId().replace(/:/g, '');
  const [measuredWidth, setMeasuredWidth] = useState<number | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [chartKind, setChartKind] = useState<'line' | 'bar'>('line');
  const [panelLayouts, setPanelLayouts] = useState<Array<{ y: number; height: number }>>([]);
  const { width: windowWidth } = useWindowDimensions();
  const chartParentWidth = measuredWidth ?? Math.max(280, windowWidth - 24 * 2 - 16 * 2);

  const chartCategories = categories.length > 0 ? categories : [''];
  const chartPanels = useMemo(() => {
    const source = panels.length > 0 ? panels : [{ series: [] }];
    return source.map((panel) => {
      const series = panel.series.map((s) => ({
        ...s,
        data: chartCategories.map((_, i) => s.data[i] ?? 0),
      }));
      const peak = Math.max(1, ...series.flatMap((s) => s.data));
      return { series, maxValue: getNiceMax(peak) };
    });
  }, [panels, chartCategories]);

  const allSeries = useMemo(() => chartPanels.flatMap((panel) => panel.series), [chartPanels]);
  const pointCount = Math.max(chartCategories.length, 1);
  const seriesCount = Math.max(1, ...chartPanels.map((panel) => panel.series.length));
  const groupInnerWidth = seriesCount * BAR_WIDTH + Math.max(seriesCount - 1, 0) * BAR_INTRA_GAP;
  const minSlotWidth = Math.max(MIN_POINT_SPACING, groupInnerWidth + BAR_GROUP_GAP);
  const minPlotWidth = INITIAL_SPACING + pointCount * minSlotWidth + END_SPACING;
  const plotWidth = Math.max(minPlotWidth, chartParentWidth - Y_AXIS_LABEL_WIDTH);
  const slotWidth = (plotWidth - INITIAL_SPACING - END_SPACING) / pointCount;
  const barGroupGap = slotWidth - groupInnerWidth;
  const lineInitialSpacing = INITIAL_SPACING + groupInnerWidth / 2;
  const lineEndSpacing =
    plotWidth - lineInitialSpacing - Math.max(pointCount - 1, 0) * slotWidth;
  const plotScrollWidth = chartParentWidth - Y_AXIS_LABEL_WIDTH;

  const wrapperClass = 'rounded-xl border border-[#2A2A2A] bg-[#1A1A1A]';

  const header = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        marginBottom: loading ? 8 : 12,
      }}
    >
      {title ? (
        <Text className="text-white font-instrument-semibold text-sm">{title}</Text>
      ) : null}
      <SeriesLegend series={allSeries} />
      <ChartKindToggle chartKind={chartKind} onChange={setChartKind} />
    </View>
  );

  if (loading) {
    return (
      <View className={wrapperClass}>
        <View className="p-4">
          {header}
          <Text className="text-gray-400 font-instrument text-sm">Loading chart...</Text>
        </View>
      </View>
    );
  }

  const labelEvery = Math.max(1, Math.ceil(chartCategories.length / 8));
  const lastIndex = chartCategories.length - 1;
  const pointX = (i: number) => lineInitialSpacing + i * slotWidth;
  const stripLeft = (i: number) => (i === 0 ? 0 : INITIAL_SPACING + i * slotWidth);
  const stripWidth = (i: number) => {
    if (chartCategories.length <= 1) return plotWidth;
    if (i === 0) return INITIAL_SPACING + slotWidth;
    if (i === lastIndex) return Math.max(slotWidth, plotWidth - (INITIAL_SPACING + i * slotWidth));
    return slotWidth;
  };
  const valueY = (value: number, maxValue: number) =>
    Y_AXIS_EXTRA_TOP + CHART_HEIGHT * (1 - value / maxValue);

  const panelTop = (index: number) => {
    const measured = panelLayouts[index]?.y;
    if (measured != null) return measured;
    let y = 0;
    for (let i = 0; i < index; i++) {
      y += fallbackPanelHeight(i === chartPanels.length - 1) + PANEL_GAP;
    }
    return y;
  };

  const toPoints = (data: number[] | undefined, showXLabels: boolean) =>
    (data ?? []).map((value, i) => ({
      value,
      label: showXLabels && i % labelEvery === 0 ? chartCategories[i] ?? '' : '',
      labelTextStyle: { color: '#9CA3AF', fontSize: 10, fontFamily: FONT_FAMILY },
    }));

  const sharedAxisProps = {
    height: CHART_HEIGHT,
    width: plotWidth,
    noOfSections: Y_AXIS_SECTIONS,
    xAxisThickness: 1,
    xAxisColor: '#2A2A2A',
    yAxisThickness: 0,
    yAxisLabelWidth: 0,
    hideYAxisText: true,
    yAxisTextStyle: { color: '#9CA3AF', fontSize: 11, fontFamily: FONT_FAMILY },
    xAxisLabelTextStyle: { color: '#9CA3AF', fontSize: 10, fontFamily: FONT_FAMILY },
    hideRules: false,
    rulesColor: '#2A2A2A',
    rulesThickness: 1,
    backgroundColor: 'transparent',
    isAnimated: false,
    disableScroll: true,
  } as const;

  const hoverOverlay =
    Platform.OS === 'web' ? (
      <View
        pointerEvents="box-none"
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          right: 0,
          bottom: 0,
        }}
      >
        {hoverIndex != null && chartKind === 'line' ? (
          <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }}>
            <View
              style={
                {
                  position: 'absolute',
                  left: pointX(hoverIndex),
                  top: 0,
                  bottom: 0,
                  width: 1,
                  backgroundImage:
                    'repeating-linear-gradient(to bottom, rgba(255,255,255,0.4) 0px, rgba(255,255,255,0.4) 4px, transparent 4px, transparent 8px)',
                } as ViewStyle
              }
            />
            {chartPanels.flatMap((panel, panelIndex) =>
              panel.series.map((s) => (
                <View
                  key={`${panelIndex}-${s.name}`}
                  style={{
                    position: 'absolute',
                    left: pointX(hoverIndex) - 4,
                    top: panelTop(panelIndex) + valueY(s.data[hoverIndex] ?? 0, panel.maxValue) - 4,
                    width: 8,
                    height: 8,
                    borderRadius: 4,
                    backgroundColor: s.color,
                    borderWidth: 1,
                    borderColor: '#1A1A1A',
                  }}
                />
              )),
            )}
          </View>
        ) : null}
        {chartCategories.map((category, i) => (
          <View
            key={`${category}-${i}`}
            style={{
              position: 'absolute',
              left: stripLeft(i),
              width: Math.max(stripWidth(i), 12),
              top: 0,
              bottom: 0,
              cursor: 'crosshair',
            } as ViewStyle}
            {...({
              onMouseEnter: () => setHoverIndex(i),
              onMouseLeave: () => setHoverIndex((current) => (current === i ? null : current)),
            } as ViewProps)}
          >
            <Tooltip
              placement="cursor"
              content={
                <PointerTooltip
                  category={category || '—'}
                  series={allSeries}
                  index={i}
                  categoryKind={categoryKind}
                />
              }
              style={{ flex: 1, height: '100%' }}
            >
              <View style={{ flex: 1 }} />
            </Tooltip>
          </View>
        ))}
      </View>
    ) : null;

  const plots = chartPanels.map((panel, panelIndex) => {
    const isLast = panelIndex === chartPanels.length - 1;
    const primary = panel.series[0] ?? {
      name: '',
      color: CAMPAIGN_STAT_COLORS.sent,
      data: chartCategories.map(() => 0),
    };
    const secondary = panel.series[1];
    const tertiary = panel.series[2];
    const quaternary = panel.series[3];
    const barSeries = panel.series.length > 0 ? panel.series : [primary];
    const barData = chartCategories.flatMap((category, i) =>
      barSeries.map((s, si) => {
        const value = s.data[i] ?? 0;
        return {
          value,
          frontColor: s.color,
          label: isLast && si === 0 && i % labelEvery === 0 ? category : '',
          labelWidth: si === 0 ? groupInnerWidth : 0,
          labelComponent: si === 0 ? undefined : () => null,
          spacing: si === barSeries.length - 1 ? barGroupGap : BAR_INTRA_GAP,
          barWidth: BAR_WIDTH,
          labelTextStyle:
            si === 0 ? { color: '#9CA3AF', fontSize: 10, fontFamily: FONT_FAMILY } : undefined,
          topLabelComponent:
            value > 0
              ? () => (
                  <View style={{ marginTop: 20 }}>
                    <Text
                      style={{
                        color: s.color,
                        fontSize: 10,
                        fontFamily: FONT_FAMILY_SEMIBOLD,
                      }}
                    >
                      {Math.round(value)}
                    </Text>
                  </View>
                )
              : undefined,
        };
      }),
    );

    const areaFills = panel.series
      .filter((s) => !s.dashed)
      .map((s, i) => {
        const points: Array<[number, number]> = s.data.map((value, index) => [
          pointX(index),
          valueY(value, panel.maxValue),
        ]);
        return {
          name: s.name,
          color: s.color,
          d: areaFillPath(points, PLOT_BOTTOM),
          gradientId: `trend-fill-${fillIdPrefix}-${panelIndex}-${i}`,
        };
      })
      .filter((fill) => fill.d.length > 0);

    const areaFillOverlay =
      chartKind === 'line' && areaFills.length > 0 ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: plotWidth,
            height: PLOT_BOTTOM,
          }}
        >
          <Svg width={plotWidth} height={PLOT_BOTTOM}>
            <Defs>
              {areaFills.map((fill) => (
                <LinearGradient
                  key={fill.gradientId}
                  id={fill.gradientId}
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <Stop offset="0" stopColor={fill.color} stopOpacity={AREA_FILL_START_OPACITY} />
                  <Stop offset="1" stopColor={fill.color} stopOpacity={AREA_FILL_END_OPACITY} />
                </LinearGradient>
              ))}
            </Defs>
            {areaFills.map((fill) => (
              <Path key={fill.name} d={fill.d} fill={`url(#${fill.gradientId})`} />
            ))}
          </Svg>
        </View>
      ) : null;

    const nativePointerConfig =
      Platform.OS === 'web'
        ? undefined
        : {
            pointerStripHeight: CHART_HEIGHT,
            pointerStripColor: 'rgba(255,255,255,0.28)',
            pointerStripWidth: 1,
            strokeDashArray: [4, 4],
            pointerColor: primary.color,
            pointer1Color: primary.color,
            pointer2Color: secondary?.color,
            pointer3Color: tertiary?.color,
            pointer4Color: quaternary?.color,
            radius: 5,
            pointerStripUptoDataPoint: false,
            autoAdjustPointerLabelPosition: true,
            pointerLabelWidth: 200,
            pointerLabelHeight: 148,
            activatePointersOnLongPress: false,
            persistPointer: false,
            pointerVanishDelay: 80,
            shiftPointerLabelY: 12,
            pointerLabelComponent: (
              _items: Array<{ value?: number }>,
              _secondary: unknown,
              pointerIndex: number,
            ) => {
              const index = pointerIndex >= 0 ? pointerIndex : 0;
              const category = chartCategories[index] ?? '';
              if (!category) return null;
              return (
                <View
                  style={{
                    paddingHorizontal: 10,
                    paddingVertical: 8,
                    borderRadius: 8,
                    backgroundColor: '#1A1A1A',
                    borderWidth: 1,
                    borderColor: '#2A2A2A',
                  }}
                >
                  <PointerTooltip
                    category={category}
                    series={allSeries}
                    index={index}
                    categoryKind={categoryKind}
                  />
                </View>
              );
            },
          };

    return (
      <View
        key={`panel-${panelIndex}`}
        onLayout={(e) => {
          const { y, height } = e.nativeEvent.layout;
          setPanelLayouts((current) => {
            const prev = current[panelIndex];
            if (prev && prev.y === y && prev.height === height) return current;
            const next = current.slice();
            next[panelIndex] = { y, height };
            return next;
          });
        }}
        style={{
          width: plotWidth,
          marginTop: panelIndex === 0 ? 0 : PANEL_GAP,
          paddingBottom: isLast ? CHART_X_LABEL_PADDING_BOTTOM : 0,
        }}
      >
        <View style={{ position: 'relative', width: plotWidth }}>
          {areaFillOverlay}
          {chartKind === 'bar' ? (
            <BarChart
              data={barData}
              barWidth={BAR_WIDTH}
              spacing={BAR_INTRA_GAP}
              initialSpacing={INITIAL_SPACING}
              endSpacing={END_SPACING}
              maxValue={panel.maxValue}
              labelsDistanceFromXaxis={isLast ? 8 : 0}
              roundedBottom={false}
              barBorderTopLeftRadius={2}
              barBorderTopRightRadius={2}
              showScrollIndicator={false}
              scrollToEnd={false}
              {...sharedAxisProps}
            />
          ) : (
            <LineChart
              data={toPoints(primary.data, isLast)}
              data2={secondary ? toPoints(secondary.data, isLast) : undefined}
              data3={tertiary ? toPoints(tertiary.data, isLast) : undefined}
              data4={quaternary ? toPoints(quaternary.data, isLast) : undefined}
              color={primary.color}
              color2={secondary?.color}
              color3={tertiary?.color}
              color4={quaternary?.color}
              thickness={2}
              thickness2={2}
              thickness3={2}
              thickness4={2}
              strokeDashArray2={secondary?.dashed ? [6, 4] : undefined}
              strokeDashArray3={tertiary?.dashed ? [6, 4] : undefined}
              strokeDashArray4={quaternary?.dashed ? [6, 4] : undefined}
              hideDataPoints
              curved
              curveType={CurveType.QUADRATIC}
              formatYLabel={formatYAxisLabel}
              spacing={slotWidth}
              initialSpacing={lineInitialSpacing}
              endSpacing={lineEndSpacing}
              maxValue={panel.maxValue}
              pointerConfig={nativePointerConfig}
              {...sharedAxisProps}
            />
          )}
        </View>
      </View>
    );
  });

  return (
    <View className={wrapperClass}>
      <View className="p-4">
        {header}
        <View
          style={{ position: 'relative', flexDirection: 'row' }}
          onLayout={(e) => {
            const w = e.nativeEvent.layout.width;
            if (w > 0) setMeasuredWidth(w);
          }}
        >
          <View style={{ width: Y_AXIS_LABEL_WIDTH }}>
            {chartPanels.map((panel, panelIndex) => {
              const isLast = panelIndex === chartPanels.length - 1;
              const height = panelLayouts[panelIndex]?.height ?? fallbackPanelHeight(isLast);
              return (
                <View
                  key={`axis-${panelIndex}`}
                  style={{
                    height,
                    marginTop: panelIndex === 0 ? 0 : PANEL_GAP,
                  }}
                >
                  <StickyChartYAxis
                    extraTop={Y_AXIS_EXTRA_TOP}
                    chartHeight={CHART_HEIGHT}
                    maxValue={panel.maxValue}
                    noOfSections={Y_AXIS_SECTIONS}
                    width={Y_AXIS_LABEL_WIDTH}
                    formatLabel={(value) => formatYAxisLabel(String(value))}
                  />
                </View>
              );
            })}
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator
            style={{ width: plotScrollWidth, overscrollBehaviorX: 'contain' as const }}
            contentContainerStyle={{
              width: Math.max(plotWidth, plotScrollWidth),
            }}
          >
            <View style={{ position: 'relative', width: plotWidth }}>
              {plots}
              {hoverOverlay}
            </View>
          </ScrollView>
        </View>
        {caption ? (
          <Text className="text-gray-500 font-instrument text-xs mt-3">{caption}</Text>
        ) : null}
      </View>
    </View>
  );
}
