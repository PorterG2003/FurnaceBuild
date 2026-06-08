import { ActivityIndicator, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomSheet, getBottomSheetBodyScrollMaxHeight } from '@/components/ui/modals';
import { PencilIcon, PlayIcon, TagIcon, TrashIcon } from 'react-native-heroicons/outline';
import { TestConnectionResultPanel } from './TestConnectionResultPanel';
import type { TestConnectionResult } from './types';
import type { Mailbox } from '@/lib/supabase/types';

export interface MailboxActionsSheetProps {
  visible: boolean;
  onClose: () => void;
  mailbox: Mailbox | null;
  testingMailboxId: string | null;
  testResult: TestConnectionResult | null;
  testResultMailboxEmail: string | null;
  onTest: (mailbox: Mailbox) => void;
  onManageTags: (mailbox: Mailbox) => void;
  onEdit: (mailbox: Mailbox) => void;
  onDelete: (mailbox: Mailbox) => void;
  /** Clear sheet test UI and close sheet (Done on result, or after dismiss). */
  onDismissTestResult: () => void;
}

export function MailboxActionsSheet({
  visible,
  onClose,
  mailbox,
  testingMailboxId,
  testResult,
  testResultMailboxEmail,
  onTest,
  onManageTags,
  onEdit,
  onDelete,
  onDismissTestResult,
}: MailboxActionsSheetProps) {
  const { height: screenHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const scrollMaxHeight = getBottomSheetBodyScrollMaxHeight(screenHeight, insets.bottom);

  const isTesting = mailbox != null && testingMailboxId === mailbox.id;
  const showResult =
    mailbox != null &&
    testResult != null &&
    testResultMailboxEmail === mailbox.email_address;

  const header = mailbox ? (
    <View className="border-b border-[#2A2A2A] pb-4 mb-1">
      <Text className="text-white font-instrument-semibold text-lg" numberOfLines={1}>
        {mailbox.display_name || mailbox.email_address}
      </Text>
      <Text className="text-gray-400 font-instrument text-sm mt-1" numberOfLines={2}>
        {mailbox.email_address}
      </Text>
    </View>
  ) : null;

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      {mailbox ? (
        <ScrollView
          style={{ maxHeight: scrollMaxHeight }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
        >
          {header}
          {showResult && testResult ? (
            <TestConnectionResultPanel
              variant="inSheet"
              testResult={testResult}
              dismissLabel="Done"
              onDismiss={onDismissTestResult}
            />
          ) : isTesting ? (
            <View className="py-10 items-center justify-center gap-4">
              <ActivityIndicator size="large" color="#F3440D" />
              <Text className="text-gray-400 font-instrument text-base">Testing connection…</Text>
            </View>
          ) : (
            <>
              <Pressable
                onPress={() => onTest(mailbox)}
                disabled={isTesting}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  paddingVertical: 14,
                  borderBottomWidth: 1,
                  borderBottomColor: '#2A2A2A',
                }}
              >
                <PlayIcon size={20} color="#9CA3AF" />
                <Text className="text-white font-instrument-medium text-base">Test connection</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  onManageTags(mailbox);
                  onClose();
                }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  paddingVertical: 14,
                  borderBottomWidth: 1,
                  borderBottomColor: '#2A2A2A',
                }}
              >
                <TagIcon size={20} color="#9CA3AF" />
                <Text className="text-white font-instrument-medium text-base">Manage tags</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  onEdit(mailbox);
                  onClose();
                }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  paddingVertical: 14,
                  borderBottomWidth: 1,
                  borderBottomColor: '#2A2A2A',
                }}
              >
                <PencilIcon size={20} color="#9CA3AF" />
                <Text className="text-white font-instrument-medium text-base">Edit mailbox</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  onDelete(mailbox);
                  onClose();
                }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  paddingVertical: 14,
                }}
              >
                <TrashIcon size={20} color="#F87171" />
                <Text className="text-red-400 font-instrument-medium text-base">Delete mailbox</Text>
              </Pressable>
            </>
          )}
        </ScrollView>
      ) : null}
    </BottomSheet>
  );
}
