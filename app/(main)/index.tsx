import { View } from 'react-native';
import { NavBar } from '@/components/ui/NavBar';

export default function Dashboard() {
  return (
    <View className="flex-1 bg-[#121212] flex-row">
      {/* Navigation Sidebar */}
      <NavBar />
      
      {/* Main Content Area */}
      <View className="flex-1 relative">
      </View>
    </View>
  );
}

