import { View, Text } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { buildInterlockingSegmentPath } from '@/components/ui/dial-ring-path';

export interface MultiSegmentDialSegment {
  value: number;
  color: string;
}

export interface MultiSegmentDialLegendRow {
  label: string;
  value: number;
  color: string;
}

export interface MultiSegmentDialLegend {
  placement: 'right' | 'bottom';
  rows: MultiSegmentDialLegendRow[];
  secondaryRows?: MultiSegmentDialLegendRow[];
  compact?: boolean;
}

interface MultiSegmentDialProps {
  segments: MultiSegmentDialSegment[];
  total: number;
  size?: number;
  label?: string;
  /** Stroke width of the ring; default 6. Use a larger value (e.g. 10) for a bigger dial. */
  strokeWidth?: number;
  /** When set with centerTotal, show fraction in the center instead of total. */
  centerValue?: number;
  centerTotal?: number;
  /** Optional labels above/below the fraction (e.g. "Completed", "Total"). */
  centerTopLabel?: string;
  centerBottomLabel?: string;
  legend?: MultiSegmentDialLegend;
}

function DialLegendRows({
  rows,
  compact = false,
  muted = false,
  rowGap,
}: {
  rows: MultiSegmentDialLegendRow[];
  compact?: boolean;
  muted?: boolean;
  rowGap?: number;
}) {
  if (rows.length === 0) return null;

  const swatchSize = compact ? 6 : 10;
  const resolvedRowGap = rowGap ?? (compact ? 4 : 8);
  const labelClassName = compact ? 'font-instrument text-xs' : 'font-instrument text-sm';
  const valueClassName = compact ? 'font-instrument text-xs' : 'font-instrument text-sm';

  return (
    <View>
      {rows.map((row, index) => (
        <View
          key={`${row.label}-${row.color}-${index}`}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            marginBottom: index < rows.length - 1 ? resolvedRowGap : 0,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: compact ? 4 : 8, flex: 1, minWidth: 0 }}>
            <View
              style={{
                width: swatchSize,
                height: swatchSize,
                borderRadius: 2,
                backgroundColor: row.color,
              }}
            />
            <Text
              className={`${muted ? 'text-gray-500' : 'text-gray-300'} ${labelClassName}`}
              numberOfLines={1}
            >
              {row.label}
            </Text>
          </View>
          <Text
            className={`${muted ? 'text-gray-400' : 'text-white'} ${valueClassName}`}
            style={{ marginLeft: compact ? 4 : 0, minWidth: compact ? 28 : 60, textAlign: 'right' }}
            numberOfLines={1}
          >
            {row.value.toLocaleString()}
          </Text>
        </View>
      ))}
    </View>
  );
}

/**
 * Multi-segment ring dial with the same visual style as ProgressDial.
 * Each segment uses the category color and occupies a proportional arc.
 */
export function MultiSegmentDial({
  segments,
  total,
  size = 150,
  label = '',
  strokeWidth: strokeWidthProp,
  centerValue,
  centerTotal,
  centerTopLabel,
  centerBottomLabel,
  legend,
}: MultiSegmentDialProps) {
  const strokeWidth = strokeWidthProp ?? 6;
  const halfStroke = strokeWidth / 2;
  const radius = (size - strokeWidth) / 2;
  const center = size / 2;
  const effectiveTotal = total > 0 ? total : 0;
  const dialWidth = label ? size + 40 : size;
  const twoPi = 2 * Math.PI;

  const showFraction =
    centerValue !== undefined &&
    centerTotal !== undefined;

  const segmentAngles =
    effectiveTotal > 0
      ? segments.map((segment) =>
          Math.max(0, (Math.max(segment.value, 0) / effectiveTotal) * twoPi)
        )
      : [];
  // Ensure segments fill the ring: assign any rounding remainder to the last segment
  if (segmentAngles.length > 0) {
    const sum = segmentAngles.reduce((a, b) => a + b, 0);
    const diff = twoPi - sum;
    if (Math.abs(diff) > 1e-6) {
      const lastIdx = segmentAngles.length - 1;
      segmentAngles[lastIdx] = segmentAngles[lastIdx] + diff;
    }
  }

  let angleOffset = 0;
  const segmentPaths =
    effectiveTotal > 0
      ? segments.map((segment, index) => {
          const span = segmentAngles[index] ?? 0;
          const startAngle = angleOffset;
          angleOffset += span;

          if (span <= 0) return null;

          return (
            <Path
              key={`${index}-${segment.color}`}
              d={buildInterlockingSegmentPath({
                cx: center,
                cy: center,
                radius,
                halfStroke,
                startAngle,
                endAngle: startAngle + span,
              })}
              fill={segment.color}
            />
          );
        })
      : null;

  const dialContent = (
    <View className="items-center shrink-0" style={{ width: dialWidth }}>
      <View style={{ width: size, height: size, position: 'relative' }}>
        <Svg width={size} height={size} style={{ transform: [{ rotate: '-90deg' }] }}>
          <Circle
            cx={center}
            cy={center}
            r={radius}
            stroke="#2A2A2A"
            strokeWidth={strokeWidth}
            fill="transparent"
          />
          {segmentPaths}
        </Svg>

        <View
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {effectiveTotal > 0 ? (
            showFraction ? (
              <View style={{ alignItems: 'center', justifyContent: 'center' }}>
                <Text
                  className="text-white font-instrument-semibold"
                  style={{ fontSize: size * 0.24, lineHeight: size * 0.3 }}
                >
                  {centerValue ?? 0}
                </Text>
                {centerTopLabel ? (
                  <Text
                    className="font-instrument-medium"
                    style={{
                      fontSize: size * 0.068,
                      color: '#6b7280',
                      marginTop: 1,
                    }}
                  >
                    {centerTopLabel}
                  </Text>
                ) : null}
                <View
                  style={{
                    width: size * 0.36,
                    height: 1,
                    backgroundColor: '#27272a',
                    marginVertical: size * 0.014,
                    borderRadius: 0,
                  }}
                />
                <Text
                  className="font-instrument"
                  style={{
                    fontSize: size * 0.16,
                    lineHeight: size * 0.2,
                    color: '#9ca3af',
                  }}
                >
                  {centerTotal ?? 0}
                </Text>
                {centerBottomLabel ? (
                  <Text
                    className="font-instrument-medium"
                    style={{
                      fontSize: size * 0.068,
                      color: '#6b7280',
                      marginTop: 1,
                    }}
                  >
                    {centerBottomLabel}
                  </Text>
                ) : null}
              </View>
            ) : (
              <Text
                className="text-white font-instrument-semibold"
                style={{ fontSize: size * 0.2, lineHeight: size * 0.26 }}
              >
                {effectiveTotal}
              </Text>
            )
          ) : null}
        </View>
      </View>

      {label ? (
        <Text
          className="text-gray-400 font-instrument text-xs mt-3 text-center"
          style={{ width: dialWidth }}
        >
          {label}
        </Text>
      ) : null}
    </View>
  );

  if (!legend) {
    return dialContent;
  }

  const legendContent = (
    <View
      className={legend.placement === 'right' ? 'flex-1 min-w-0' : 'w-full mt-3'}
      style={legend.placement === 'right' ? { minWidth: 0 } : undefined}
    >
      <DialLegendRows
        rows={legend.rows}
        compact={legend.compact}
        rowGap={legend.placement === 'bottom' ? 0 : undefined}
      />
      {legend.secondaryRows?.length ? (
        <View className={legend.compact ? 'mt-2' : 'mt-3'}>
          <DialLegendRows
            rows={legend.secondaryRows}
            compact={legend.compact}
            muted
            rowGap={legend.placement === 'bottom' ? 0 : undefined}
          />
        </View>
      ) : null}
    </View>
  );

  return (
    <View
      className={legend.placement === 'right' ? 'flex-row items-center gap-6' : 'items-center'}
      style={legend.placement === 'right' ? { minWidth: 0 } : undefined}
    >
      {dialContent}
      {legendContent}
    </View>
  );
}
