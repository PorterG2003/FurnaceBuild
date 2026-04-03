import { Modal, Pressable, Text, View } from 'react-native';
import { XMarkIcon } from 'react-native-heroicons/outline';
import { IconButton } from '@/components/ui/icon-button';
import { TestConnectionResultPanel } from './TestConnectionResultPanel';
import type { TestConnectionResult } from './types';

export interface TestResultModalProps {
  visible: boolean;
  testResult: TestConnectionResult | null;
  testResultMailboxEmail: string | null;
  onClose: () => void;
}

export function TestResultModal({
  visible,
  testResult,
  testResultMailboxEmail,
  onClose,
}: TestResultModalProps) {
  return (
    <Modal
      visible={visible && testResult !== null}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View
        style={{
          flex: 1,
          backgroundColor: 'rgba(0, 0, 0, 0.8)',
          justifyContent: 'center',
          alignItems: 'center',
          padding: 20,
        }}
      >
        <Pressable
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
          onPress={onClose}
        />
        <View
          style={{
            backgroundColor: '#1A1A1A',
            borderRadius: 20,
            borderWidth: 1,
            borderColor: '#2A2A2A',
            width: '100%',
            maxWidth: 420,
            overflow: 'hidden',
          }}
        >
          {testResult && (
            <>
              <View className="flex-row items-center justify-between px-5 py-4 border-b border-[#2A2A2A]">
                {testResultMailboxEmail ? (
                  <Text className="flex-1 font-instrument-semibold text-lg text-white" numberOfLines={1}>
                    {testResultMailboxEmail}
                  </Text>
                ) : (
                  <View className="flex-1" />
                )}
                <IconButton
                  variant="ghost"
                  size="sm"
                  icon={XMarkIcon}
                  onPress={onClose}
                  className="-mr-2"
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                />
              </View>
              <TestConnectionResultPanel testResult={testResult} onDismiss={onClose} />
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}
