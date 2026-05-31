import { Stack } from 'expo-router';
import { FluxGate, FluxPageLayout } from '@/components/flux';

export default function FluxLayout() {
  return (
    <FluxGate>
      <FluxPageLayout scrollable={false}>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { flex: 1, backgroundColor: '#121212' },
          }}
        />
      </FluxPageLayout>
    </FluxGate>
  );
}
