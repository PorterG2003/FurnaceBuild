import { Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CheckIcon, EnvelopeOpenIcon } from 'react-native-heroicons/outline';
import { BottomSheet, getBottomSheetBodyScrollMaxHeight } from '@/components/ui/modals';
import type { AppNotification } from '@/lib/supabase/services/notifications';

const rowStyle = {
  flexDirection: 'row' as const,
  alignItems: 'center' as const,
  gap: 12,
  paddingVertical: 14,
};

export interface NotificationItemActionsSheetProps {
  visible: boolean;
  onClose: () => void;
  notification: AppNotification | null;
  onMarkAsRead?: (n: AppNotification) => void | Promise<void>;
  onMarkAsUnread?: (n: AppNotification) => void | Promise<void>;
}

export function NotificationItemActionsSheet({
  visible,
  onClose,
  notification,
  onMarkAsRead,
  onMarkAsUnread,
}: NotificationItemActionsSheetProps) {
  const { height: screenHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const scrollMaxHeight = getBottomSheetBodyScrollMaxHeight(screenHeight, insets.bottom);

  const unread = notification != null && notification.read_at == null;
  const read = notification != null && notification.read_at != null;

  const header = notification ? (
    <View className="border-b border-[#2A2A2A] pb-4 mb-1">
      <Text className="text-white font-instrument-semibold text-lg" numberOfLines={2}>
        {notification.title?.trim() || 'Notification'}
      </Text>
      {notification.body?.trim() ? (
        <Text className="text-gray-400 font-instrument text-sm mt-1" numberOfLines={2}>
          {notification.body.trim()}
        </Text>
      ) : null}
    </View>
  ) : null;

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      {notification ? (
        <ScrollView
          style={{ maxHeight: scrollMaxHeight }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
        >
          {header}
          {unread && onMarkAsRead ? (
            <Pressable
              onPress={() => {
                void (async () => {
                  await Promise.resolve(onMarkAsRead(notification));
                  onClose();
                })();
              }}
              style={{ ...rowStyle, borderBottomWidth: 0 }}
            >
              <CheckIcon size={20} color="#9CA3AF" />
              <Text className="text-white font-instrument-medium text-base">Mark as read</Text>
            </Pressable>
          ) : null}
          {read && onMarkAsUnread ? (
            <Pressable
              onPress={() => {
                void (async () => {
                  await Promise.resolve(onMarkAsUnread(notification));
                  onClose();
                })();
              }}
              style={{ ...rowStyle, borderBottomWidth: 0 }}
            >
              <EnvelopeOpenIcon size={20} color="#9CA3AF" />
              <Text className="text-white font-instrument-medium text-base">Mark as unread</Text>
            </Pressable>
          ) : null}
        </ScrollView>
      ) : null}
    </BottomSheet>
  );
}
