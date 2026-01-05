import { View, Text } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

interface ProgressDialProps {
  value: number;
  total?: number;
  label: string;
  color?: string;
  size?: number;
}

/**
 * Circular progress dial component
 * Shows a number in the center with a circular progress ring
 */
export function ProgressDial({
  value,
  total,
  label,
  color = '#f85102',
  size = 100,
}: ProgressDialProps) {
  const percentage = total && total > 0 ? Math.min((value / total) * 100, 100) : 0;
  const strokeWidth = 8;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (percentage / 100) * circumference;
  const center = size / 2;

  return (
    <View className="items-center" style={{ width: size + 40 }}>
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
          {/* Progress circle */}
          {percentage > 0 && (
            <Circle
              cx={center}
              cy={center}
              r={radius}
              stroke={color}
              strokeWidth={strokeWidth}
              fill="transparent"
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              strokeLinecap="round"
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
        </View>
      </View>

      {/* Label */}
      <Text
        className="text-gray-400 font-instrument text-xs mt-3 text-center"
        style={{ width: size + 40 }}
      >
        {label}
      </Text>
    </View>
  );
}
