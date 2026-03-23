import { Stack } from 'expo-router';
import { AccountProvider } from '@/contexts/AccountContext';
import { FoundryGate, FoundryPageLayout } from '@/components/foundry';

export default function FoundryLayout() {
  return (
    <FoundryGate>
      <AccountProvider>
        <FoundryPageLayout scrollable={false}>
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { flex: 1, backgroundColor: '#121212' },
            }}
          />
        </FoundryPageLayout>
      </AccountProvider>
    </FoundryGate>
  );
}
