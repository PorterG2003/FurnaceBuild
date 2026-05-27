import { Stack } from 'expo-router';

export default function LeadsLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="lists/index" />
      <Stack.Screen name="lists/[listId]" />
      <Stack.Screen name="[globalLeadId]" />
    </Stack>
  );
}
