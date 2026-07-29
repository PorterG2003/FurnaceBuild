import { View, Text } from 'react-native';

/** Compact chip for blocked prospect emails in inbox headers. */
export function BlockedBadge() {
  return (
    <View
      className="rounded px-1.5 py-0.5 shrink-0"
      style={{
        backgroundColor: 'rgba(234, 179, 8, 0.15)',
        borderWidth: 1,
        borderColor: 'rgba(234, 179, 8, 0.35)',
      }}
    >
      <Text className="text-[10px] font-instrument-medium leading-tight" style={{ color: '#EAB308' }}>
        Blocked
      </Text>
    </View>
  );
}
