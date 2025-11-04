import { useEffect } from 'react';
import { View } from 'react-native';
import { NavBar } from '@/components/ui/NavBar';
import { Background } from '@/components/ui/Background';
import { useBackground } from '@/contexts/BackgroundContext';

export default function Dashboard() {
  const { setVariant } = useBackground();

  useEffect(() => {
    // Set dotted background for dashboard
    setVariant('dots');
    
    // Cleanup: reset to solid when leaving
    return () => {
      setVariant('solid');
    };
  }, [setVariant]);
  
  return (
    <View className="flex-1 bg-[#121212] flex-row">
      {/* Navigation Sidebar */}
      <NavBar />
      
      {/* Main Content Area */}
      <View className="flex-1 relative">
        <Background />
      </View>
    </View>
  );
}

