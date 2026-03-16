import { Text, View } from 'react-native';

interface ModalStepIndicatorProps {
  steps: readonly string[];
  activeIndex: number;
  wrap?: boolean;
}

export function ModalStepIndicator({
  steps,
  activeIndex,
  wrap = false,
}: ModalStepIndicatorProps) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        flexWrap: wrap ? 'wrap' : undefined,
        gap: 16,
      }}
    >
      {steps.map((label, index) => {
        const isActive = index === activeIndex;
        const isComplete = index < activeIndex;

        return (
          <View key={label} style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ alignItems: 'center', minWidth: 88 }}>
              <View
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: isActive
                    ? '#F3440D'
                    : isComplete
                      ? 'rgba(243,68,13,0.4)'
                      : 'rgba(255,255,255,0.08)',
                }}
              >
                <Text style={{ color: '#FFFFFF', fontSize: 14, fontWeight: '600' }}>
                  {index + 1}
                </Text>
              </View>
              <Text
                style={{
                  marginTop: 6,
                  color: isActive ? '#FFFFFF' : '#9CA3AF',
                  fontSize: 11,
                  fontFamily: 'Instrument Sans, system-ui, sans-serif',
                  fontWeight: isActive ? '600' : '500',
                  letterSpacing: 1,
                  textTransform: 'uppercase',
                  textAlign: 'center',
                }}
              >
                {label}
              </Text>
            </View>
            {index < steps.length - 1 && (
              <View
                style={{
                  width: 40,
                  height: 1,
                  backgroundColor: 'rgba(255,255,255,0.1)',
                  marginHorizontal: 8,
                }}
              />
            )}
          </View>
        );
      })}
    </View>
  );
}
