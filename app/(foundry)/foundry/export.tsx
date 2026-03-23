import { Text, ScrollView, View } from 'react-native';
import { PageHeader, Breadcrumb } from '@/components/ui/layout';

export default function FoundryExportScreen() {
  return (
    <ScrollView
      className="flex-1"
      contentContainerStyle={{ padding: 16, flexGrow: 1 }}
      showsVerticalScrollIndicator={false}
    >
      <View className="mb-4">
        <Breadcrumb items={[{ label: 'Foundry', href: '/foundry' }, { label: 'Export' }]} />
      </View>
      <PageHeader title="Export" subtitle="Data export (placeholder)" />
      <Text className="text-gray-400 font-instrument text-base leading-6 mt-2">
        Boilerplate — configure formats and download links here.
      </Text>
    </ScrollView>
  );
}
