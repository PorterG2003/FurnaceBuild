import { Stack } from 'expo-router';
import { FoundryGate, FoundryPageLayout } from '@/components/foundry';

export default function FoundryLayout() {
  return (
    <FoundryGate>
      <FoundryPageLayout scrollable={false}>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { flex: 1, backgroundColor: '#121212' },
          }}
        />
      </FoundryPageLayout>
    </FoundryGate>
  );
}
