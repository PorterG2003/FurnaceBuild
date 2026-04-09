import { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, StyleSheet, View } from 'react-native';
import {
  BOOT_SPINNER_R,
  BOOT_SPINNER_SIZE,
  BOOT_SPINNER_STROKE,
  BOOT_SPINNER_STROKE_DASHARRAY,
} from '@/lib/bootSpinnerShared';

/**
 * Web: inline SVG (must match `public/index.html` byte-for-byte on geometry).
 * Native: Animated border ring.
 */
export function BootSpinner() {
  if (Platform.OS === 'web') {
    return (
      <svg
        width={BOOT_SPINNER_SIZE}
        height={BOOT_SPINNER_SIZE}
        viewBox="0 0 36 36"
        role="progressbar"
        aria-label="Loading"
        style={{
          display: 'block',
          flexShrink: 0,
          overflow: 'visible',
          verticalAlign: 'middle',
        }}
      >
        <circle
          cx="18"
          cy="18"
          r={BOOT_SPINNER_R}
          fill="none"
          stroke="rgba(243, 68, 13, 0.22)"
          strokeWidth={BOOT_SPINNER_STROKE}
        />
        <g>
          <animateTransform
            attributeName="transform"
            attributeType="xml"
            type="rotate"
            from="0 18 18"
            to="360 18 18"
            dur="0.75s"
            repeatCount="indefinite"
          />
          <circle
            cx="18"
            cy="18"
            r={BOOT_SPINNER_R}
            fill="none"
            stroke="#f3440d"
            strokeWidth={BOOT_SPINNER_STROKE}
            strokeLinecap="round"
            strokeDasharray={BOOT_SPINNER_STROKE_DASHARRAY}
            transform="rotate(-90 18 18)"
          />
        </g>
      </svg>
    );
  }

  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 750,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [spin]);

  const rotate = spin.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <View style={styles.wrap} accessibilityRole="progressbar" accessibilityLabel="Loading">
      <Animated.View style={[styles.ring, { transform: [{ rotate }] }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: BOOT_SPINNER_SIZE,
    height: BOOT_SPINNER_SIZE,
    minWidth: BOOT_SPINNER_SIZE,
    minHeight: BOOT_SPINNER_SIZE,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    width: BOOT_SPINNER_SIZE,
    height: BOOT_SPINNER_SIZE,
    minWidth: BOOT_SPINNER_SIZE,
    minHeight: BOOT_SPINNER_SIZE,
    flexShrink: 0,
    borderRadius: BOOT_SPINNER_SIZE / 2,
    borderWidth: BOOT_SPINNER_STROKE,
    borderColor: 'rgba(243, 68, 13, 0.22)',
    borderTopColor: '#f3440d',
  },
});
