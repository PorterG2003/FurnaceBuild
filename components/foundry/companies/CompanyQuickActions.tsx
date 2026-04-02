import { View, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from '@/components/ui/button';

export function CompanyQuickActions() {
  const router = useRouter();

  return (
    <View className="mb-4">
      <Text className="text-gray-500 font-instrument text-[10px] uppercase tracking-wider mb-2">Quick actions</Text>
      <View className="flex-row flex-wrap gap-2">
        <Button variant="outline" size="sm" onPress={() => router.push('/foundry/export')}>
          Export
        </Button>
        <Button variant="outline" size="sm" onPress={() => router.push('/foundry/queue')}>
          Queue
        </Button>
        <Button variant="outline" size="sm" onPress={() => router.push('/foundry/imports')}>
          Imports
        </Button>
      </View>
    </View>
  );
}
