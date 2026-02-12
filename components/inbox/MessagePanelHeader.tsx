import { View, Text, Pressable } from 'react-native';
import { NoSymbolIcon } from 'react-native-heroicons/outline';

/** Sticky header: subject, then prospect(s) vs sender with clear separation */
export function MessagePanelHeader({
  subject,
  prospectEmails,
  senderEmails,
  blockedEmails = [],
  onBlock,
  showBlockButton = true,
}: {
  subject: string;
  prospectEmails: string[];
  senderEmails: string[];
  blockedEmails?: string[] | Set<string>;
  onBlock?: () => void;
  showBlockButton?: boolean;
}) {
  const blockedSet = blockedEmails instanceof Set ? blockedEmails : new Set(blockedEmails);
  const hasBlocked = prospectEmails.some((e) => blockedSet.has(e.trim().toLowerCase()));
  const hasProspects = prospectEmails.length > 0;

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
        {hasProspects && (
          <View className="flex-row items-start gap-3 py-1.5">
            <View className="rounded-md bg-[#1A1A1A] px-2 py-0.5 self-start">
              <Text className="text-gray-500 font-instrument-medium text-xs">
                Prospect{prospectEmails.length !== 1 ? 's' : ''}
              </Text>
            </View>
            <View className="flex-1 gap-1">
              {prospectEmails.map((email) => {
                const isBlocked = blockedSet.has(email.trim().toLowerCase());
                return (
                  <View key={email} className="flex-row items-center gap-2 flex-wrap">
                    <Text className="text-gray-300 font-instrument text-sm" numberOfLines={1}>
                      {email}
                    </Text>
                    {isBlocked && (
                      <View className="flex-row items-center gap-1 rounded-md bg-amber-500/20 px-2 py-0.5">
                        <NoSymbolIcon size={12} color="#F59E0B" />
                        <Text className="text-amber-400 font-instrument-medium text-xs">Blocked</Text>
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
            {showBlockButton && onBlock && (
              <Pressable
                onPress={onBlock}
                className="flex-row items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#3A3A3A] bg-[#2A2A2A]"
              >
                <NoSymbolIcon size={14} color="#9CA3AF" />
                <Text className="text-gray-400 font-instrument-medium text-xs">Block</Text>
              </Pressable>
            )}
          </View>
        )}
        {hasBlocked && (
          <Text className="text-gray-500 font-instrument text-xs mt-1.5">
            No automated emails will be sent to blocked addresses. Manual replies allowed.
          </Text>
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
        {!hasProspects && senderEmails.length === 0 && (
          <Text className="text-gray-500 font-instrument text-sm py-2">—</Text>
        )}
      </View>
    </View>
  );
}
