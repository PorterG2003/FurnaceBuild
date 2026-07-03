import { useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';
import Svg, { Rect } from 'react-native-svg';

const AnimatedRect = Animated.createAnimatedComponent(Rect);

interface StepDwellDialProps {
  /** Measured size of the button this ring traces. */
  width: number;
  height: number;
  borderRadius: number;
  durationMs: number;
  color?: string;
  /** When true, gate on time but don't animate the ring (accessibility). */
  reducedMotion?: boolean;
  /** Fires once the dwell time elapses so the parent can unlock Next. */
  onComplete: () => void;
}

/**
 * A read-gate rendered as the Next button's own progress border: a rounded-rect
 * stroke that fills over `durationMs`, so a disabled Next in a mandatory tour
 * reads as "unlocks shortly," not "broken." Presentation-only — it never
 * advances the engine itself, it only re-enables the button via `onComplete`.
 */
export function StepDwellDial({
  width,
  height,
  borderRadius,
  durationMs,
  color = '#f85102',
  reducedMotion = false,
  onComplete,
}: StepDwellDialProps) {
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const strokeWidth = 2;
  const inset = strokeWidth / 2;
  const w = Math.max(0, width - strokeWidth);
  const h = Math.max(0, height - strokeWidth);
  const r = Math.max(0, borderRadius - inset);
  const perimeter = 2 * (w + h) - 8 * r + 2 * Math.PI * r;

  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (width <= 0 || height <= 0 || durationMs <= 0) {
      onCompleteRef.current();
      return;
    }
    if (reducedMotion) {
      const t = setTimeout(() => onCompleteRef.current(), durationMs);
      return () => clearTimeout(t);
    }
    progress.setValue(0);
    const anim = Animated.timing(progress, {
      toValue: 1,
      duration: durationMs,
      easing: Easing.linear,
      useNativeDriver: false,
    });
    anim.start(({ finished }) => {
      if (finished) onCompleteRef.current();
    });
    return () => anim.stop();
    // Restart only if the geometry or timing changes (the parent remounts this
    // per step via `key`, so this effectively runs once per step).
  }, [width, height, durationMs, reducedMotion, progress]);

  if (width <= 0 || height <= 0 || reducedMotion) return null;

  const strokeDashoffset = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [perimeter, 0],
  });

  return (
    <Svg
      width={width}
      height={height}
      style={{ position: 'absolute', top: 0, left: 0 }}
      pointerEvents="none"
    >
      <AnimatedRect
        x={inset}
        y={inset}
        width={w}
        height={h}
        rx={r}
        ry={r}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeDasharray={perimeter}
        strokeDashoffset={strokeDashoffset}
        strokeLinecap="round"
      />
    </Svg>
  );
}
