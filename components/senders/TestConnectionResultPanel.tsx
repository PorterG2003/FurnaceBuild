import { Text, View } from 'react-native';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import type { TestConnectionResult } from './types';

export interface TestConnectionResultPanelProps {
  testResult: TestConnectionResult;
  onDismiss: () => void;
  /** Primary button label (default `Close`; use `Done` in bottom sheet flow). */
  dismissLabel?: string;
  /**
   * `inSheet`: no horizontal padding — parent `BottomSheet` already applies horizontal inset.
   * `card` (default): `px-5` for centered modal body.
   */
  variant?: 'card' | 'inSheet';
}

export function TestConnectionResultPanel({
  testResult,
  onDismiss,
  dismissLabel = 'Close',
  variant = 'card',
}: TestConnectionResultPanelProps) {
  return (
    <View className={cn('py-5', variant === 'inSheet' ? 'px-0' : 'px-5')}>
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
        {!testResult.success && testResult.message ? (
          <Text className="text-center text-gray-400 font-instrument text-sm mt-2">{testResult.message}</Text>
        ) : null}
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
      <Button onPress={onDismiss} className="w-full">
        {dismissLabel}
      </Button>
    </View>
  );
}
