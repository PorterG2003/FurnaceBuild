import * as React from "react";
import { View } from "react-native";

type Density = "low" | "off";

type Props = {
  density?: Density;
  maxOpacity?: number;
};

type Particle = {
  x: number;
  y: number;
  vx: number; // horizontal velocity
  vy: number; // vertical velocity
  scale: number;
  opacity: number;
  maxOpacity: number;
  life: number;
  maxLife: number;
  size: number;
  turbulencePhase: number; // for wind turbulence
  windStrength: number; // how much wind affects this particle
};

export default function EmberParticlesLite({ 
  density = "low", 
  maxOpacity = 0.06 
}: Props) {
  // For now, return a simple static overlay since Canvas isn't available
  // In a real implementation, you'd use react-native-skia or similar
  if (density === "off") {
    return null;
  }

  return (
    <View className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 1 }}>
      {/* Simple static ember effect using gradients */}
      <View className="absolute bottom-0 left-1/2 transform -translate-x-1/2 w-32 h-32 bg-[radial-gradient(50%_50%_at_50%_50%,rgba(255,181,107,0.1)_0%,transparent_70%)]" />
      <View className="absolute bottom-4 left-1/3 w-16 h-16 bg-[radial-gradient(50%_50%_at_50%_50%,rgba(255,77,0,0.08)_0%,transparent_70%)]" />
      <View className="absolute bottom-8 right-1/3 w-20 h-20 bg-[radial-gradient(50%_50%_at_50%_50%,rgba(255,181,107,0.06)_0%,transparent_70%)]" />
    </View>
  );
}
