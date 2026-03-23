import { Text, ScrollView, View } from 'react-native';
import { PageHeader, Breadcrumb } from '@/components/ui/layout';

export default function FoundryJobsScreen() {
  return (
    <ScrollView
      className="flex-1"
      contentContainerStyle={{ padding: 16, flexGrow: 1 }}
      showsVerticalScrollIndicator={false}
    >
      <View className="mb-4">
        <Breadcrumb items={[{ label: 'Foundry', href: '/foundry' }, { label: 'Jobs' }]} />
      </View>
      <PageHeader title="Jobs" subtitle="Resolution queue & jobs (placeholder)" />
      <Text className="text-gray-400 font-instrument text-base leading-6 mt-2">
        Source-to-company resolution and review_tasks will surface here. After a CSV import, use this as the
        staging link until the queue UI ships.
      </Text>
    </ScrollView>
  );
}
