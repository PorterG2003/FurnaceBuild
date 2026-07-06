import { useId } from 'react';
import { Platform, View } from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import {
  OPEN_CONVERSATION_COLOR,
  OPEN_CONVERSATION_GLOW,
} from './inboxConstants';

const SIZES = {
  default: { dot: 6, glow: 20 },
  compact: { dot: 6, glow: 14 },
} as const;

type OpenConversationIndicatorProps = {
  size?: keyof typeof SIZES;
};

export function OpenConversationIndicator({ size = 'default' }: OpenConversationIndicatorProps) {
  const glowId = useId().replace(/:/g, '');
  const { dot: dotSize, glow: glowSize } = SIZES[size];

  return (
    <View
      style={{
        width: glowSize,
        height: glowSize,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Svg
        style={{
          position: 'absolute',
          width: glowSize,
          height: glowSize,
        }}
        viewBox={`0 0 ${glowSize} ${glowSize}`}
      >
        <Defs>
          <RadialGradient id={glowId} cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor="rgba(243, 68, 13, 0.85)" />
            <Stop offset="22%" stopColor="rgba(243, 68, 13, 0.55)" />
            <Stop offset="45%" stopColor={OPEN_CONVERSATION_GLOW} />
            <Stop offset="72%" stopColor="rgba(243, 68, 13, 0.14)" />
            <Stop offset="100%" stopColor="rgba(243, 68, 13, 0)" />
          </RadialGradient>
        </Defs>
        <Circle
          cx={glowSize / 2}
          cy={glowSize / 2}
          r={glowSize / 2}
          fill={`url(#${glowId})`}
        />
      </Svg>
      <View
        className="rounded-full"
        style={{
          width: dotSize,
          height: dotSize,
          backgroundColor: OPEN_CONVERSATION_COLOR,
          ...(Platform.OS === 'web'
            ? { boxShadow: '0 0 8px 1px rgba(243, 68, 13, 0.65)' }
            : {
                shadowColor: OPEN_CONVERSATION_COLOR,
                shadowOffset: { width: 0, height: 0 },
                shadowOpacity: 1,
                shadowRadius: size === 'compact' ? 3 : 4,
                elevation: 4,
              }),
        }}
      />
    </View>
  );
}
