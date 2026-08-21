import { useState } from 'react';
import { View } from 'react-native';
import Svg, { G, Path } from 'react-native-svg';
import { Skeleton } from '@/components/ui/feedback';
import { Card } from '@/components/ui/Card';
import { StaggeredFadeIn } from './skeletonUtils';

const CHART_HEIGHT = 220;
const Y_AXIS_WIDTH = 48;
const Y_AXIS_SECTIONS = 4;
const Y_AXIS_EXTRA_TOP = CHART_HEIGHT / 20;
const PANEL_GAP = 16;
const GRID_COLOR = '#2A2A2A';
const SILHOUETTE_COLORS = ['#6B7280', '#4B5563'] as const;
const FILL_OPACITY = 0.28;
const STROKE_OPACITY = 0.55;

const VOLUME_SERIES: number[][] = [
  [0.38, 0.44, 0.36, 0.58, 0.52, 0.76, 0.68, 0.88],
  [0.22, 0.26, 0.28, 0.4, 0.36, 0.5, 0.46, 0.58],
];
const OUTCOME_SERIES: number[][] = [
  [0.42, 0.3, 0.5, 0.34, 0.56, 0.4, 0.62, 0.48],
  [0.16, 0.14, 0.24, 0.18, 0.3, 0.22, 0.34, 0.28],
];

const Y_TICK_WIDTHS = [28, 24, 28, 22, 16];
const X_TICK_COUNT = 7;

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

function valuesToPoints(
  values: number[],
  width: number,
  plotTop: number,
  plotHeight: number,
): Array<[number, number]> {
  const padX = 8;
  const usable = Math.max(1, width - padX * 2);
  const last = Math.max(values.length - 1, 1);
  return values.map((v, i) => {
    const x = padX + (usable * i) / last;
    const y = plotTop + plotHeight * (1 - v);
    return [x, y];
  });
}

function YAxisTicks() {
  const plotHeight = Y_AXIS_EXTRA_TOP + CHART_HEIGHT;
  const stepHeight = CHART_HEIGHT / Y_AXIS_SECTIONS;
  return (
    <View style={{ width: Y_AXIS_WIDTH, height: plotHeight }}>
      {Y_TICK_WIDTHS.map((width, i) => (
        <View
          key={i}
          style={{
            position: 'absolute',
            top: Y_AXIS_EXTRA_TOP + stepHeight * i - 5,
            left: 0,
            width: Y_AXIS_WIDTH,
            alignItems: 'center',
          }}
        >
          <Skeleton style={{ width, height: 10, borderRadius: 3 }} />
        </View>
      ))}
    </View>
  );
}

function PlotPanel({
  series,
  showXAxis,
}: {
  series: number[][];
  showXAxis: boolean;
}) {
  const [width, setWidth] = useState(0);
  const plotHeight = Y_AXIS_EXTRA_TOP + CHART_HEIGHT;

  return (
    <View className="flex-row">
      <YAxisTicks />
      <View className="flex-1" onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        <View style={{ height: plotHeight }}>
          {Array.from({ length: Y_AXIS_SECTIONS + 1 }, (_, i) => (
            <View
              key={i}
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                top: Y_AXIS_EXTRA_TOP + (CHART_HEIGHT / Y_AXIS_SECTIONS) * i,
                height: 1,
                backgroundColor: GRID_COLOR,
              }}
            />
          ))}
          {width > 0 ? (
            <Svg width={width} height={plotHeight}>
              {series.map((values, seriesIndex) => {
                const points = valuesToPoints(values, width, Y_AXIS_EXTRA_TOP, CHART_HEIGHT);
                const color = SILHOUETTE_COLORS[seriesIndex] ?? GRID_COLOR;
                return (
                  <G key={seriesIndex}>
                    <Path
                      d={areaFillPath(points, Y_AXIS_EXTRA_TOP + CHART_HEIGHT)}
                      fill={color}
                      fillOpacity={FILL_OPACITY}
                    />
                    <Path
                      d={quadraticLinePath(points)}
                      fill="none"
                      stroke={color}
                      strokeOpacity={STROKE_OPACITY}
                      strokeWidth={2}
                    />
                  </G>
                );
              })}
            </Svg>
          ) : null}
        </View>
        {showXAxis ? (
          <View className="flex-row justify-between mt-2 px-1">
            {Array.from({ length: X_TICK_COUNT }, (_, i) => (
              <Skeleton
                key={i}
                style={{ width: i % 2 === 0 ? 28 : 22, height: 8, borderRadius: 3 }}
              />
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}

export function MetricCardsSkeleton({ count = 7 }: { count?: number }) {
  return (
    <View className="flex-row flex-wrap gap-3 mb-8">
      {Array.from({ length: count }, (_, index) => (
        <StaggeredFadeIn key={index} index={index}>
          <Card variant="card" className="min-w-[160px] flex-1">
            <Skeleton style={{ width: 88, height: 12, borderRadius: 4, marginBottom: 10 }} />
            <Skeleton style={{ width: 72, height: 28, borderRadius: 4 }} />
            <Skeleton style={{ width: 120, height: 10, borderRadius: 4, marginTop: 8 }} />
          </Card>
        </StaggeredFadeIn>
      ))}
    </View>
  );
}

export function AccountTrendChartSkeleton() {
  return (
    <View>
      <StaggeredFadeIn index={0}>
        <PlotPanel series={VOLUME_SERIES} showXAxis={false} />
      </StaggeredFadeIn>
      <StaggeredFadeIn index={1}>
        <View style={{ marginTop: PANEL_GAP }}>
          <PlotPanel series={OUTCOME_SERIES} showXAxis />
        </View>
      </StaggeredFadeIn>
    </View>
  );
}
