import * as React from "react";
import { View } from "react-native";

type Intensity = "off" | "low" | "medium";
type Speed = "slow" | "normal" | "slower";
type Tint = "none" | "ember";

type Props = {
  className?: string;
  children?: React.ReactNode;
  /** Rendered above the background layers but below `children` (e.g. floating particles). */
  midground?: React.ReactNode;
  intensity?: Intensity;
  speed?: Speed;
  tint?: Tint;
};

// Full-bleed hero background base with dark charcoal gradient, soft vignette, and subtle heat shimmer.
// Tailwind only, no images, no JS, pure SVG/CSS animations.
// Exposes palette tokens as CSS variables on the root element of the component.
// Respects prefers-reduced-motion by disabling shimmer animation.
export function HeroHeatShimmer({ 
  className, 
  children,
  midground,
  intensity = "low",
  speed = "slow",
  tint = "none"
}: Props) {
  // Map props to SVG values
  const intensityMap: Record<Intensity, { scale: number; opacity: number }> = {
    off: { scale: 0, opacity: 0 },
    low: { scale: 1.5, opacity: 0.3 },
    medium: { scale: 3, opacity: 0.5 }
  };
  
  const speedMap: Record<Speed, string> = {
    slow: "16s",
    normal: "12s", 
    slower: "24s"
  };
  
  const { scale, opacity } = intensityMap[intensity];
  const duration = speedMap[speed];
  
  return (
    <View className={`flex-1 ${className || ""}`}>
      {/* Background layers */}
      <View className="absolute inset-0">
        {/* Vertical charcoal gradient - exact Furnace colors */}
        <View className="absolute inset-0 bg-gradient-to-b from-[#121212] to-[#1A1A1A]" />
        
        {/* Soft vignette: darker edges, clear center */}
        <View className="absolute inset-0 bg-[radial-gradient(140%_120%_at_50%_55%,rgba(0,0,0,0)_0%,rgba(0,0,0,0)_50%,rgba(0,0,0,0.6)_100%)]" />
        
        {/* Warm tint near bottom */}
        <View className="absolute inset-0 opacity-40 bg-[radial-gradient(70%_50%_at_50%_110%,#FF4D00_0%,transparent_70%)]" />
        <View className="absolute inset-0 opacity-25 bg-[radial-gradient(50%_35%_at_50%_110%,#FFB56B_0%,transparent_70%)]" />
        
        {/* Bottom glow */}
        <View className="absolute inset-x-0 bottom-0 h-[30vh] w-full bg-[radial-gradient(100%_100%_at_50%_100%,rgba(255,77,0,0.35)_0%,rgba(255,77,0,0.20)_50%,transparent_100%)]" />
      </View>

      {midground ? (
        <View className="absolute inset-0 z-[5] pointer-events-none overflow-hidden">
          {midground}
        </View>
      ) : null}

      {/* Foreground content */}
      <View className="relative z-10 flex-1">{children}</View>
    </View>
  );
}
