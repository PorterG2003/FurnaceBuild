import * as React from 'react';
import { useEffect, useRef } from 'react';
import { useWindowDimensions, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';

type Density = 'low' | 'off';

type Props = {
  density?: Density;
  maxOpacity?: number;
};

type EmberSpec = {
  id: number;
  leftPct: number;
  size: number;
  durationMs: number;
  opacity: number;
  r: number;
  g: number;
  b: number;
  /** Net horizontal drift (px) from bottom → top — prevailing wind along rising path */
  driftPx: number;
  /** Angular spatial frequencies (rad/px of vertical travel) for gust components */
  k1: number;
  k2: number;
  k3: number;
  /** Phase offsets (rad) */
  p1: number;
  p2: number;
  p3: number;
  /** Amplitudes (px) for each gust harmonic */
  amp1: number;
  amp2: number;
  amp3: number;
  /** 0–1 phase offset in the continuous cycle; keeps particles de-synchronized across remounts */
  phaseOffset: number;
  /** Offsets gust sampling so the bottom edge isn’t a special phase (px, added to y in sin) */
  waveAnchor: number;
};

function buildEmberSpecs(count: number, maxOpacity: number): EmberSpec[] {
  const specs: EmberSpec[] = [];
  for (let i = 0; i < count; i += 1) {
    const warm = Math.random() > 0.45;
    specs.push({
      id: i,
      leftPct: 4 + Math.random() * 88,
      size: 3 + Math.random() * 9,
      durationMs: 9000 + Math.random() * 14000,
      opacity: maxOpacity * (0.45 + Math.random() * 0.55),
      r: warm ? 255 : 240 + Math.random() * 15,
      g: warm ? 70 + Math.random() * 100 : 40 + Math.random() * 40,
      b: warm ? Math.random() * 35 : Math.random() * 20,
      driftPx: (Math.random() - 0.5) * 36,
      k1: 0.022 + Math.random() * 0.045,
      k2: 0.012 + Math.random() * 0.028,
      k3: 0.006 + Math.random() * 0.018,
      p1: Math.random() * Math.PI * 2,
      p2: Math.random() * Math.PI * 2,
      p3: Math.random() * Math.PI * 2,
      amp1: 5 + Math.random() * 16,
      amp2: 2.5 + Math.random() * 11,
      amp3: 1 + Math.random() * 7,
      phaseOffset: Math.random(),
      waveAnchor: (Math.random() - 0.5) * 520,
    });
  }
  return specs;
}

/** Stacked filled circles with stepped alpha (soft halo → hot core). No box-shadow — shadows read as rings on small dots. */
function FloatingEmber({
  leftPct,
  size,
  durationMs,
  opacity,
  r,
  g,
  b,
  travel,
  driftPx,
  k1,
  k2,
  k3,
  p1,
  p2,
  p3,
  amp1,
  amp2,
  amp3,
  phaseOffset,
  waveAnchor,
  clockMs,
}: EmberSpec & { travel: number; clockMs: SharedValue<number> }) {
  /** Time/phase-based motion: no reset event to skip when the tab is backgrounded. */
  const animatedStyle = useAnimatedStyle(() => {
    const cycleMs = Math.max(1, durationMs);
    const phase = (clockMs.value / cycleMs + phaseOffset) % 1;
    const y = -travel * phase;
    const yw = y + waveAnchor;
    const gustX =
      amp1 * Math.sin(yw * k1 + p1) +
      amp2 * Math.sin(yw * k2 + p2) +
      amp3 * Math.sin(yw * k3 + p3);
    const x = driftPx * phase + gustX;
    return {
      transform: [{ translateX: x }, { translateY: y }],
    };
  });

  const d = size * 2.4;
  const rr = Math.round(r);
  const rg = Math.round(g);
  const rb = Math.round(b);
  const cr = Math.min(255, r + 38);
  const cg = Math.min(255, g + 62);
  const cb = Math.min(255, b + 28);

  const layers: { w: number; a: number; rc: number; gc: number; bc: number }[] = [
    { w: d, a: Math.min(0.22, opacity * 1.1), rc: rr, gc: rg, bc: rb },
    { w: d * 0.62, a: Math.min(0.38, opacity * 2.1), rc: rr, gc: rg, bc: rb },
    { w: d * 0.34, a: Math.min(0.58, opacity * 3.4), rc: rr, gc: rg, bc: rb },
    { w: d * 0.16, a: Math.min(0.88, opacity * 6.5), rc: cr, gc: cg, bc: cb },
  ];

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          left: `${leftPct}%`,
          bottom: -d * 0.12,
          width: d,
          height: d,
          marginLeft: -d / 2,
          alignItems: 'center',
          justifyContent: 'center',
        },
        animatedStyle,
      ]}
    >
      {layers.map((layer, i) => (
        <View
          key={i}
          style={{
            position: 'absolute',
            left: (d - layer.w) / 2,
            top: (d - layer.w) / 2,
            width: layer.w,
            height: layer.w,
            borderRadius: layer.w / 2,
            backgroundColor: `rgba(${Math.round(layer.rc)},${Math.round(layer.gc)},${Math.round(layer.bc)},${layer.a})`,
          }}
        />
      ))}
    </Animated.View>
  );
}

export function EmberParticlesLite({ density = 'low', maxOpacity = 0.06 }: Props) {
  const { height: windowHeight } = useWindowDimensions();
  const travel = Math.max(420, windowHeight * 1.15);
  const clockMs = useSharedValue(0);

  const specsRef = useRef<EmberSpec[] | null>(null);
  if (specsRef.current == null) {
    specsRef.current = buildEmberSpecs(22, maxOpacity);
  }

  useEffect(() => {
    let rafId = 0;
    let startMs = 0;

    const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

    const tick = (ts: number) => {
      const current = typeof ts === 'number' ? ts : nowMs();
      if (startMs === 0) startMs = current;
      clockMs.value = current - startMs;
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [clockMs]);

  if (density === 'off') {
    return null;
  }

  return (
    <View
      className="absolute inset-0 w-full h-full overflow-hidden pointer-events-none"
      style={{ zIndex: 1 }}
      collapsable={false}
    >
      {specsRef.current.map((spec) => (
        <FloatingEmber key={spec.id} {...spec} travel={travel} clockMs={clockMs} />
      ))}
    </View>
  );
}
