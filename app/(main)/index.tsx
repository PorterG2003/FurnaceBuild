import { View, useWindowDimensions } from 'react-native';
import Svg, { Defs, Pattern, Circle, Rect } from 'react-native-svg';
import { NavBar } from '@/components/ui/NavBar';

export default function Dashboard() {
  const { width, height } = useWindowDimensions();
  
  return (
    <View className="flex-1 bg-[#121212] flex-row">
      {/* Navigation Sidebar */}
      <NavBar />
      
      {/* Main Content Area */}
      <View className="flex-1 relative">
        {/* Grid dot background */}
        <View className="absolute inset-0">
          <Svg width={width} height={height}>
            <Defs>
              <Pattern id="dot-pattern" x="0" y="0" width="20" height="20" patternUnits="userSpaceOnUse">
                <Circle cx="10" cy="10" r="1" fill="#2A2A2A" />
              </Pattern>
            </Defs>
            <Rect width="100%" height="100%" fill="url(#dot-pattern)" />
          </Svg>
        </View>
      </View>
    </View>
  );
}

