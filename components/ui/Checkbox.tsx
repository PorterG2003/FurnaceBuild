import { useState, useEffect } from 'react';
import { TouchableOpacity, View, Text, Platform } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  Easing,
} from 'react-native-reanimated';

interface CheckboxProps {
  checked: boolean;
  onPress: (event?: any) => void;
  indeterminate?: boolean;
  disabled?: boolean;
  size?: number;
  circleSize?: number;
}

export function Checkbox({
  checked,
  onPress,
  indeterminate = false,
  disabled = false,
  size = 20,
  circleSize = 40,
}: CheckboxProps) {
  const [isHovered, setIsHovered] = useState(false);

  // Animated values
  const circleOpacity = useSharedValue(0);
  const circleScale = useSharedValue(0.8);
  const checkboxScale = useSharedValue(1);

  // Animate circle on hover - quick grow out, no bounce
  useEffect(() => {
    if (isHovered) {
      circleOpacity.value = withTiming(1, {
        duration: 120,
        easing: Easing.out(Easing.ease),
      });
      circleScale.value = withTiming(1, {
        duration: 120,
        easing: Easing.out(Easing.ease),
      });
    } else {
      circleOpacity.value = withTiming(0, {
        duration: 120,
        easing: Easing.in(Easing.ease),
      });
      circleScale.value = withTiming(0.85, {
        duration: 120,
        easing: Easing.in(Easing.ease),
      });
    }
  }, [isHovered, circleOpacity, circleScale]);

  // Animate checkbox on state change - quick grow, no bounce
  useEffect(() => {
    checkboxScale.value = withTiming(checked ? 1.05 : 1, {
      duration: 100,
      easing: Easing.out(Easing.ease),
    });
  }, [checked, checkboxScale]);

  const handlePress = (e?: any) => {
    if (disabled) {
      return;
    }
    if (e?.stopPropagation) {
      e.stopPropagation();
    }
    onPress(e);
  };

  // Animated styles
  const circleAnimatedStyle = useAnimatedStyle(() => {
    return {
      opacity: circleOpacity.value,
      transform: [{ scale: circleScale.value }],
    };
  });

  const checkboxAnimatedStyle = useAnimatedStyle(() => {
    return {
      transform: [{ scale: checkboxScale.value }],
    };
  });

  return (
    <TouchableOpacity
      onPress={handlePress}
      activeOpacity={0.7}
      onPressIn={() => setIsHovered(true)}
      onPressOut={() => setIsHovered(false)}
      style={{
        width: circleSize,
        height: circleSize,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled ? 0.5 : 1,
      }}
      disabled={disabled}
      // @ts-ignore - web-only prop
      onMouseEnter={() => Platform.OS === 'web' && setIsHovered(true)}
      onMouseLeave={() => Platform.OS === 'web' && setIsHovered(false)}
    >
      {/* Outer circle - visible on hover with animation, no border */}
      <Animated.View
        style={[
          {
            position: 'absolute',
            width: circleSize,
            height: circleSize,
            borderRadius: circleSize / 2,
            backgroundColor: checked || indeterminate
              ? 'rgba(248, 81, 2, 0.06)'
              : 'rgba(255, 255, 255, 0.03)',
          },
          circleAnimatedStyle,
        ]}
      />
      
      {/* Checkbox */}
      <Animated.View
        style={[
          {
            width: size,
            height: size,
            borderRadius: 4,
            borderWidth: 2,
            borderColor: checked || indeterminate ? '#f85102' : '#4A4A4A',
            backgroundColor: checked ? '#f85102' : 'transparent',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1,
          },
          checkboxAnimatedStyle,
        ]}
      >
        {checked && !indeterminate && (
          <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: 'bold' }}>✓</Text>
        )}
        {indeterminate && !checked && (
          <View
            style={{
              width: size * 0.5,
              height: 2,
              backgroundColor: '#f85102',
            }}
          />
        )}
      </Animated.View>
    </TouchableOpacity>
  );
}

