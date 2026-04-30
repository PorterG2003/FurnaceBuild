import React, { useEffect } from 'react';
import { View, Pressable } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  interpolateColor,
} from 'react-native-reanimated';

const TRACK_HEIGHT = 14;
const TRACK_WIDTH = 44;
const THUMB_SIZE = 22;
const THUMB_TRAVEL = TRACK_WIDTH - THUMB_SIZE;
/** Outer height must fit the thumb; track is shorter and vertically centered (avoids clipping). */
const OUTER_HEIGHT = THUMB_SIZE;
const TRACK_TOP = (OUTER_HEIGHT - TRACK_HEIGHT) / 2;

export interface ToggleProps {
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
  /** Track background when off. Default `#404040`. */
  trackColorOff?: string;
  /** Track background when on. Default `#F3440D`. */
  trackColorOn?: string;
  /** Thumb when off. Default `#A3A3A3`. */
  thumbColorOff?: string;
  /** Thumb when on. Default `#FFFFFF`. */
  thumbColorOn?: string;
}

export function Toggle({
  value,
  onValueChange,
  disabled = false,
  trackColorOff = '#404040',
  trackColorOn = '#F3440D',
  thumbColorOff = '#A3A3A3',
  thumbColorOn = '#FFFFFF',
}: ToggleProps) {
  const position = useSharedValue(value ? 1 : 0);

  useEffect(() => {
    position.value = withTiming(value ? 1 : 0, {
      duration: 150,
    });
  }, [value, position]);

  const trackAnimatedStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      position.value,
      [0, 1],
      [trackColorOff, trackColorOn]
    ),
  }));

  const thumbAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: position.value * THUMB_TRAVEL }],
    backgroundColor: interpolateColor(
      position.value,
      [0, 1],
      [thumbColorOff, thumbColorOn]
    ),
  }));

  return (
    <Pressable
      onPress={() => !disabled && onValueChange(!value)}
      role="switch"
      aria-checked={value}
      aria-disabled={disabled}
      style={({ pressed }) => ({
        opacity: disabled ? 0.5 : pressed ? 0.9 : 1,
      })}
    >
      <View
        style={{
          width: TRACK_WIDTH,
          height: OUTER_HEIGHT,
          position: 'relative',
          overflow: 'visible',
        }}
      >
        <Animated.View
          style={[
            {
              position: 'absolute',
              left: 0,
              top: TRACK_TOP,
              width: TRACK_WIDTH,
              height: TRACK_HEIGHT,
              borderRadius: TRACK_HEIGHT / 2,
            },
            trackAnimatedStyle,
          ]}
        />
        <Animated.View
          style={[
            {
              position: 'absolute',
              left: 0,
              top: 0,
              width: THUMB_SIZE,
              height: THUMB_SIZE,
              borderRadius: THUMB_SIZE / 2,
              ...(typeof window !== 'undefined'
                ? { boxShadow: '0px 1px 2px rgba(0,0,0,0.3)' }
                : { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.3, shadowRadius: 2, elevation: 2 }),
            },
            thumbAnimatedStyle,
          ]}
        />
      </View>
    </Pressable>
  );
}
