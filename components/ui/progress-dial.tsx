import { View, Text } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { buildRoundEndedSegmentPath } from '@/components/ui/dial-ring-path';

interface ProgressDialProps {
  value: number;
  total?: number;
  label?: string;
  color?: string;
  size?: number;
  /** When true, center displays percentage (e.g. "42%") instead of value/total */
  showAsPercentage?: boolean;
}

/**
 * Circular progress dial component
 * Shows a number in the center with a circular progress ring
 */
export function ProgressDial({
  value,
  total,
  label = '',
  color = '#f85102',
  size = 100,
  showAsPercentage = false,
}: ProgressDialProps) {
  const percentage = total && total > 0 ? Math.min((value / total) * 100, 100) : 0;
  const strokeWidth = 6;
  const halfStroke = strokeWidth / 2;
  const radius = (size - strokeWidth) / 2;
  const center = size / 2;
  const span = (percentage / 100) * 2 * Math.PI;

  const centerContent = showAsPercentage ? (
    <Text
      className="text-white font-instrument-semibold"
      style={{ fontSize: size * 0.24, lineHeight: size * 0.3 }}
    >
      {Math.round(percentage)}%
    </Text>
  ) : (
    <>
      <Text
        className="text-white font-instrument-semibold"
        style={{ fontSize: size * 0.3, lineHeight: size * 0.35 }}
      >
        {value}
      </Text>
      {total !== undefined && (
        <Text
          className="text-gray-500 font-instrument"
          style={{ fontSize: size * 0.15, lineHeight: size * 0.18, marginTop: -2 }}
        >
          / {total}
        </Text>
      )}
    </>
  );

  return (
    <View className="items-center" style={{ width: label ? size + 40 : size }}>
      <View style={{ width: size, height: size, position: 'relative' }}>
        <Svg width={size} height={size} style={{ transform: [{ rotate: '-90deg' }] }}>
          {/* Background circle */}
          <Circle
            cx={center}
            cy={center}
            r={radius}
            stroke="#2A2A2A"
            strokeWidth={strokeWidth}
            fill="transparent"
          />
          {/* Progress arc: sausage caps when open; interlocking seam at 100% */}
          {span > 0 && (
            <Path
              d={buildRoundEndedSegmentPath({
                cx: center,
                cy: center,
                radius,
                halfStroke,
                startAngle: 0,
                endAngle: span,
              })}
              fill={color}
            />
          )}
        </Svg>
        
        {/* Center content */}
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
          {centerContent}
        </View>
      </View>

      {label ? (
        <Text
          className="text-gray-400 font-instrument text-xs mt-3 text-center"
          style={{ width: size + 40 }}
        >
          {label}
        </Text>
      ) : null}
    </View>
  );
}
