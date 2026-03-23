import { Text, ScrollView } from 'react-native';
import { PageHeader } from '@/components/ui/layout';

export default function FoundryHomeScreen() {
  return (
    <ScrollView
      className="flex-1"
      contentContainerStyle={{ padding: 16, flexGrow: 1 }}
      showsVerticalScrollIndicator={false}
    >
      <PageHeader title="Foundry" subtitle="Imports, jobs, and export workspace" />
      <Text className="text-gray-400 font-instrument text-base leading-6 mt-2">
        Use the nav for Imports (Google Maps CSV), Jobs, and Export.
      </Text>
    </ScrollView>
  );
}
