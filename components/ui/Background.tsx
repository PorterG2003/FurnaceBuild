import { View, useWindowDimensions } from 'react-native';
import { useRef } from 'react';
import Svg, { Defs, Pattern, Circle, Rect } from 'react-native-svg';
import { useBackground } from '@/contexts/BackgroundContext';

// Generate unique ID for SVG pattern
let patternCounter = 0;
function generatePatternId() {
  return `dot-pattern-${++patternCounter}-${Date.now()}`;
}

export function Background() {
  const { variant } = useBackground();
  const { width, height } = useWindowDimensions();
  const patternIdRef = useRef<string | null>(null);
  
  // Generate pattern ID once per component instance
  if (!patternIdRef.current) {
    patternIdRef.current = generatePatternId();
  }
  const patternId = patternIdRef.current;

  if (variant === 'none') {
    return null;
  }

  if (variant === 'dots') {
    return (
      <View className="absolute inset-0">
        <Svg width={width} height={height}>
          <Defs>
            <Pattern 
              id={patternId} 
              x="0" 
              y="0" 
              width="20" 
              height="20" 
              patternUnits="userSpaceOnUse"
            >
              <Circle cx="10" cy="10" r="1" fill="#2A2A2A" />
            </Pattern>
          </Defs>
          <Rect width="100%" height="100%" fill={`url(#${patternId})`} />
        </Svg>
      </View>
    );
  }

  // variant === 'solid'
  return (
    <View className="absolute inset-0 bg-[#121212]" />
  );
}

