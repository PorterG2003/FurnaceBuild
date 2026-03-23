import { Stack } from 'expo-router';
import { ImportWizardProvider } from '@/components/foundry/imports';

export default function ImportsLayout() {
  return (
    <ImportWizardProvider>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { flex: 1, backgroundColor: '#121212' },
        }}
      />
    </ImportWizardProvider>
  );
}
