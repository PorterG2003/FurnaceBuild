import { View, Text } from 'react-native';

const FONT_FAMILY = 'InstrumentSans_400Regular';
const LABEL_HEIGHT = 16;

export function StickyChartYAxis({
  extraTop,
  chartHeight,
  maxValue,
  noOfSections,
  width,
  formatLabel,
  backgroundColor = '#1A1A1A',
}: {
  extraTop: number;
  chartHeight: number;
  maxValue: number;
  noOfSections: number;
  width: number;
  formatLabel: (value: number) => string;
  backgroundColor?: string;
}) {
  const stepHeight = chartHeight / noOfSections;
  return (
    <View
      pointerEvents="none"
      style={{
        width,
        height: extraTop + chartHeight,
        backgroundColor,
        zIndex: 2,
      }}
    >
      {Array.from({ length: noOfSections + 1 }, (_, i) => {
        const value = maxValue - (maxValue / noOfSections) * i;
        return (
          <View
            key={i}
            style={{
              position: 'absolute',
              top: extraTop + stepHeight * i - LABEL_HEIGHT / 2,
              left: 0,
              width,
              height: LABEL_HEIGHT,
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            <Text
              style={{
                color: '#9CA3AF',
                fontSize: 11,
                fontFamily: FONT_FAMILY,
              }}
            >
              {formatLabel(value)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}
