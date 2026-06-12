import { Stack } from 'expo-router';

export default function InboxLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, animation: 'none' }}>
      <Stack.Screen name="index" options={{ animation: 'none' }} />
      <Stack.Screen name="[threadId]" options={{ animation: 'none' }} />
      <Stack.Screen name="replace-lead" options={{ animation: 'none' }} />
    </Stack>
  );
}
