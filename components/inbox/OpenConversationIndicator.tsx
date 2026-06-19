import { useId } from 'react';
import { Platform, View } from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import {
  OPEN_CONVERSATION_COLOR,
  OPEN_CONVERSATION_GLOW,
} from './inboxConstants';

const DOT_SIZE = 6;
const GLOW_SIZE = 20;

export function OpenConversationIndicator() {
  const glowId = useId().replace(/:/g, '');

  return (
    <View
      style={{
        width: GLOW_SIZE,
        height: GLOW_SIZE,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Svg
        style={{
          position: 'absolute',
          width: GLOW_SIZE,
          height: GLOW_SIZE,
        }}
        viewBox={`0 0 ${GLOW_SIZE} ${GLOW_SIZE}`}
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
          cx={GLOW_SIZE / 2}
          cy={GLOW_SIZE / 2}
          r={GLOW_SIZE / 2}
          fill={`url(#${glowId})`}
        />
      </Svg>
      <View
        className="rounded-full"
        style={{
          width: DOT_SIZE,
          height: DOT_SIZE,
          backgroundColor: OPEN_CONVERSATION_COLOR,
          ...(Platform.OS === 'web'
            ? { boxShadow: '0 0 8px 1px rgba(243, 68, 13, 0.65)' }
            : {
                shadowColor: OPEN_CONVERSATION_COLOR,
                shadowOffset: { width: 0, height: 0 },
                shadowOpacity: 1,
                shadowRadius: 4,
                elevation: 4,
              }),
        }}
      />
    </View>
  );
}
