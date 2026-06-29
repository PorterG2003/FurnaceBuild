import { useEffect, useRef } from 'react';
import { Animated, Easing, Text, View } from 'react-native';
import {
  MegaphoneIcon,
  InboxIcon,
  ChartBarIcon,
} from 'react-native-heroicons/outline';
import { useReducedMotion } from '../useReducedMotion';

const ITEMS = [
  { icon: MegaphoneIcon, title: 'Launch campaigns', body: 'Build and send sequences that feel personal.' },
  { icon: InboxIcon, title: 'Handle replies', body: 'A unified inbox with smart triage built in.' },
  { icon: ChartBarIcon, title: 'Track what works', body: 'See opens, replies, and outcomes at a glance.' },
];

/**
 * Lightweight illustrative demo for the scaffold announcement step. Loops a
 * gentle fade/rise across feature tiles, and renders statically under reduced
 * motion. Lazy-loaded so it never weighs down the main bundle.
 */
export default function ScaffoldDemoAnimation() {
  const reducedMotion = useReducedMotion();
  const values = useRef(ITEMS.map(() => new Animated.Value(0))).current;

  useEffect(() => {
    if (reducedMotion) {
      values.forEach((v) => v.setValue(1));
      return;
    }

    const animation = Animated.loop(
      Animated.sequence([
        Animated.stagger(
          220,
          values.map((v) =>
            Animated.timing(v, {
              toValue: 1,
              duration: 480,
              easing: Easing.out(Easing.cubic),
              useNativeDriver: true,
            }),
          ),
        ),
        Animated.delay(1200),
        Animated.parallel(
          values.map((v) =>
            Animated.timing(v, {
              toValue: 0,
              duration: 260,
              easing: Easing.in(Easing.cubic),
              useNativeDriver: true,
            }),
          ),
        ),
        Animated.delay(300),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [reducedMotion, values]);

  return (
    <View className="flex-row flex-wrap gap-4">
      {ITEMS.map((item, i) => {
        const Icon = item.icon;
        const v = values[i];
        return (
          <Animated.View
            key={item.title}
            className="flex-1 min-w-[200px] rounded-2xl border border-[#2A2A2A] bg-[#181818] p-5"
            style={{
              opacity: v,
              transform: [
                {
                  translateY: v.interpolate({
                    inputRange: [0, 1],
                    outputRange: [16, 0],
                  }),
                },
              ],
            }}
          >
            <View className="mb-3 self-start rounded-xl bg-brand-orange/20 p-3">
              <Icon size={26} color="#f85102" />
            </View>
            <Text className="text-white font-instrument-semibold text-base mb-1">
              {item.title}
            </Text>
            <Text className="text-gray-400 font-instrument text-sm">{item.body}</Text>
          </Animated.View>
        );
      })}
    </View>
  );
}
