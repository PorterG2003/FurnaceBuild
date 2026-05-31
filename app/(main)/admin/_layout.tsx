import { Stack } from 'expo-router';

export default function AdminLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="accounts" />
      <Stack.Screen name="accounts/[id]" />
      <Stack.Screen name="accounts/sign-new-client" />
      <Stack.Screen name="terms" />
    </Stack>
  );
}
