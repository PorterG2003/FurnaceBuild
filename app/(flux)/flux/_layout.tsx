import { Stack } from 'expo-router';
import { AccountProvider } from '@/contexts/AccountContext';
import { FluxGate, FluxPageLayout } from '@/components/flux';

export default function FluxLayout() {
  return (
    <FluxGate>
      <AccountProvider>
        <FluxPageLayout scrollable={false}>
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { flex: 1, backgroundColor: '#121212' },
            }}
          />
        </FluxPageLayout>
      </AccountProvider>
    </FluxGate>
  );
}
