import { Modal, Pressable, Text, View } from 'react-native';
import { XMarkIcon } from 'react-native-heroicons/outline';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
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

              <View className="px-5 py-5">
                <View
                  className={`rounded-xl px-4 py-3 mb-5 ${
                    testResult.success
                      ? 'bg-green-500/15 border border-green-500/40'
                      : 'bg-red-500/15 border border-red-500/40'
                  }`}
                >
                  <Text
                    className={`text-center font-instrument-semibold text-base ${
                      testResult.success ? 'text-green-400' : 'text-red-400'
                    }`}
                  >
                    {testResult.success ? 'Connection test passed' : 'Connection test failed'}
                  </Text>
                </View>
                <View className="gap-3 mb-6">
                  {testResult.smtp && (
                    <View className="flex-row items-center justify-between py-2.5 px-4 rounded-lg bg-[#252525] border border-[#2A2A2A]">
                      <Text className="text-gray-400 font-instrument text-sm">SMTP (sending)</Text>
                      <View className="flex-row items-center gap-2">
                        {testResult.smtp.success ? (
                          <Text className="text-green-400 font-instrument text-sm">Connected</Text>
                        ) : (
                          <Text
                            className="text-red-400 font-instrument text-sm"
                            numberOfLines={1}
                            style={{ maxWidth: 180 }}
                          >
                            {testResult.smtp.error}
                          </Text>
                        )}
                      </View>
                    </View>
                  )}
                  {testResult.imap && (
                    <View className="flex-row items-center justify-between py-2.5 px-4 rounded-lg bg-[#252525] border border-[#2A2A2A]">
                      <Text className="text-gray-400 font-instrument text-sm">IMAP (receiving)</Text>
                      <View className="flex-row items-center gap-2">
                        {testResult.imap.success ? (
                          <Text className="text-green-400 font-instrument text-sm">Connected</Text>
                        ) : (
                          <Text
                            className="text-red-400 font-instrument text-sm"
                            numberOfLines={1}
                            style={{ maxWidth: 180 }}
                          >
                            {testResult.imap.error}
                          </Text>
                        )}
                      </View>
                    </View>
                  )}
                </View>
                <Button onPress={onClose} className="w-full">
                  Close
                </Button>
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}
