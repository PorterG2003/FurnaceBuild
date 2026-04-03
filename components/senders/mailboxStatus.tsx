import { Text, View } from 'react-native';

export function getStatusColor(status: string): string {
  switch (status) {
    case 'connected':
      return '#10B981';
    case 'disconnected':
      return '#6B7280';
    case 'error':
      return '#EF4444';
    default:
      return '#6B7280';
  }
}

export function MailboxStatusPill({ status }: { status: string }) {
  const color = getStatusColor(status);
  return (
    <View className="px-2 py-1 rounded self-start" style={{ backgroundColor: color + '20' }}>
      <Text className="text-xs font-instrument-medium capitalize" style={{ color }}>
        {status}
      </Text>
    </View>
  );
}
