import { View, Text } from 'react-native';

/** Sticky header: subject, then prospect(s) vs sender with clear separation */
export function MessagePanelHeader({
  subject,
  prospectEmails,
  senderEmails,
}: {
  subject: string;
  prospectEmails: string[];
  senderEmails: string[];
}) {
  return (
    <View
      className="px-5 py-4 border-b border-[#2A2A2A] bg-[#0D0D0D]"
      style={{ borderBottomWidth: 1 }}
    >
      <Text
        className="text-xl font-instrument-semibold text-white"
        numberOfLines={1}
      >
        {subject || '(No subject)'}
      </Text>
      <View className="mt-3 gap-0">
        {prospectEmails.length > 0 && (
          <View className="flex-row items-center gap-3 py-1.5">
            <View className="rounded-md bg-[#1A1A1A] px-2 py-0.5 self-start">
              <Text className="text-gray-500 font-instrument-medium text-xs">
                Prospect{prospectEmails.length !== 1 ? 's' : ''}
              </Text>
            </View>
            <Text className="text-gray-300 font-instrument text-sm flex-1" numberOfLines={2}>
              {prospectEmails.join(', ')}
            </Text>
          </View>
        )}
        {senderEmails.length > 0 && (
          <View className="flex-row items-center gap-3 py-1.5">
            <View className="rounded-md bg-[#1A1A1A] px-2 py-0.5 self-start">
              <Text className="text-gray-500 font-instrument-medium text-xs">
                Your email
              </Text>
            </View>
            <Text className="text-gray-300 font-instrument text-sm flex-1" numberOfLines={2}>
              {senderEmails.join(', ')}
            </Text>
          </View>
        )}
        {prospectEmails.length === 0 && senderEmails.length === 0 && (
          <Text className="text-gray-500 font-instrument text-sm py-2">—</Text>
        )}
      </View>
    </View>
  );
}
