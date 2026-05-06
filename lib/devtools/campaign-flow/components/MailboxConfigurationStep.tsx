import { View, Text, Pressable, TextInput, ScrollView } from 'react-native';
import { PlusIcon } from 'react-native-heroicons/outline';

interface MailboxConfigurationStepProps {
  mailboxCount: number;
  onMailboxCountChange: (count: number) => void;
  onBack: () => void;
  onNext: () => void;
}

export function MailboxConfigurationStep({
  mailboxCount,
  onMailboxCountChange,
  onBack,
  onNext,
}: MailboxConfigurationStepProps) {
  const incrementCount = () => {
    if (mailboxCount < 10) {
      onMailboxCountChange(mailboxCount + 1);
    }
  };

  const decrementCount = () => {
    if (mailboxCount > 1) {
      onMailboxCountChange(mailboxCount - 1);
    }
  };

  const handleCountChange = (text: string) => {
    const num = parseInt(text);
    if (!isNaN(num) && num >= 1 && num <= 10) {
      onMailboxCountChange(num);
    } else if (text === '') {
      onMailboxCountChange(1);
    }
  };

  return (
    <ScrollView>
      <View>
        <Text className="text-lg font-instrument-semibold text-white mb-4">
          Step 2: Configure Test Mailboxes
        </Text>

        <Text className="text-gray-400 font-instrument text-sm mb-6">
          Select the number of test mailboxes to create. These will be automatically generated with fake credentials and assigned to the campaign.
        </Text>

        <View className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-6 mb-6">
          <View className="flex-row items-center justify-between mb-4">
            <Text className="text-gray-300 font-instrument-medium text-base">Number of Mailboxes</Text>
            <View className="flex-row items-center gap-4">
              <Pressable
                onPress={decrementCount}
                disabled={mailboxCount <= 1}
                className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                  mailboxCount <= 1
                    ? 'bg-[#2A2A2A] opacity-50'
                    : 'bg-[#2A2A2A] active:bg-[#3A3A3A]'
                }`}
                style={{ width: 40, height: 40 }}
                accessibilityRole="button"
                accessibilityLabel="Decrease mailbox count"
                accessibilityState={{ disabled: mailboxCount <= 1 }}
              >
                <Text className="text-white font-instrument-semibold text-xl">−</Text>
              </Pressable>

              <TextInput
                value={mailboxCount.toString()}
                onChangeText={handleCountChange}
                keyboardType="numeric"
                className="w-16 text-center text-white font-instrument-semibold text-lg bg-[#121212] border border-[#2A2A2A] rounded-lg py-2"
                selectTextOnFocus
                accessibilityLabel="Number of mailboxes"
              />

              <Pressable
                onPress={incrementCount}
                disabled={mailboxCount >= 10}
                className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                  mailboxCount >= 10
                    ? 'bg-[#2A2A2A] opacity-50'
                    : 'bg-[#2A2A2A] active:bg-[#3A3A3A]'
                }`}
                style={{ width: 40, height: 40 }}
                accessibilityRole="button"
                accessibilityLabel="Increase mailbox count"
                accessibilityState={{ disabled: mailboxCount >= 10 }}
              >
                <PlusIcon size={20} color={mailboxCount >= 10 ? '#6b7280' : '#fff'} />
              </Pressable>
            </View>
          </View>

          <View className="bg-blue-900/20 border border-blue-800 rounded-lg p-4">
            <Text className="text-blue-400 font-instrument-semibold text-sm mb-2">
              ℹ️ Test Mailboxes
            </Text>
            <Text className="text-blue-300 font-instrument text-xs">
              {mailboxCount} test mailbox{mailboxCount !== 1 ? 'es' : ''} will be created with:
            </Text>
            <View className="mt-2 gap-1">
              <Text className="text-blue-300 font-instrument text-xs">
                • Email pattern: test-mailbox-{'{1..N}'}@furnace.test
              </Text>
              <Text className="text-blue-300 font-instrument text-xs">
                • Fake SMTP credentials (sending will be skipped)
              </Text>
              <Text className="text-blue-300 font-instrument text-xs">
                • Automatically assigned to the campaign
              </Text>
            </View>
          </View>
        </View>

        <View className="flex-row gap-3">
          <Pressable
            onPress={onBack}
            className="flex-1 bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl px-6 py-3 flex-row items-center justify-center"
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <Text className="text-gray-300 font-instrument-semibold text-base">Back</Text>
          </Pressable>
          <Pressable
            onPress={onNext}
            className="flex-1 bg-brand-orange rounded-xl px-6 py-3 flex-row items-center justify-center"
            style={{ backgroundColor: '#f85102' }}
            accessibilityRole="button"
            accessibilityLabel="Next: Configure Schedule"
          >
            <Text className="text-white font-instrument-semibold text-base">Next: Schedule</Text>
          </Pressable>
        </View>
      </View>
    </ScrollView>
  );
}
