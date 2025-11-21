import { View, Text } from 'react-native';
import { NavBar } from '@/components/ui/NavBar';

export default function InboxPage() {
  return (
    <View className="flex-1 bg-[#121212] flex-row">
      <NavBar />
      <View className="flex-1 items-center justify-center">
        <Text className="text-white text-xl">Master Inbox Page</Text>
      </View>
    </View>
  );
}
