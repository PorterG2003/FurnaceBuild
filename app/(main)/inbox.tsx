import { View, Text } from 'react-native';
import { PageLayout } from '@/components/ui/PageLayout';

export default function InboxPage() {
  return (
    <PageLayout>
      <View className="flex-1 items-center justify-center">
        <Text className="text-white text-xl">Master Inbox Page</Text>
      </View>
    </PageLayout>
  );
}
