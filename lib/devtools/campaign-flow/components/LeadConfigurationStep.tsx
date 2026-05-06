import { View, Text, Pressable, TextInput } from 'react-native';
import { MinusIcon, PlusIcon } from 'react-native-heroicons/outline';

interface LeadConfigurationStepProps {
  leadCount: number;
  onLeadCountChange: (count: number) => void;
  onBack: () => void;
  onNext: () => void;
}

export function LeadConfigurationStep({
  leadCount,
  onLeadCountChange,
  onBack,
  onNext,
}: LeadConfigurationStepProps) {
  const increment = () => {
    onLeadCountChange(leadCount + 1);
  };

  const decrement = () => {
    if (leadCount > 1) {
      onLeadCountChange(leadCount - 1);
    }
  };

  return (
    <View>
      <Text className="text-lg font-instrument-semibold text-white mb-4">
        Step 4: Configure Test Leads
      </Text>

      <Text className="text-gray-400 font-instrument text-sm mb-6">
        Select the number of test leads to automatically generate. These will be enrolled in the campaign flow test.
      </Text>

      <View className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-6 mb-6">
        <View className="flex-row items-center justify-between mb-4">
          <Text className="text-gray-300 font-instrument-medium text-base">Number of Leads</Text>
          <View className="flex-row items-center gap-4">
            <Pressable
              onPress={decrement}
              disabled={leadCount <= 1}
              className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                leadCount <= 1
                  ? 'bg-[#2A2A2A] opacity-50'
                  : 'bg-[#2A2A2A] active:bg-[#3A3A3A]'
              }`}
              style={{ width: 40, height: 40 }}
              accessibilityRole="button"
              accessibilityLabel="Decrease lead count"
              accessibilityState={{ disabled: leadCount <= 1 }}
            >
              <Text className="text-white font-instrument-semibold text-xl">−</Text>
            </Pressable>

            <TextInput
              value={leadCount.toString()}
              onChangeText={(text) => {
                // Allow empty string and any numeric input while typing
                if (text === '') {
                  onLeadCountChange(0);
                } else {
                  const num = parseInt(text);
                  if (!isNaN(num) && num >= 0) {
                    onLeadCountChange(num);
                  }
                }
              }}
              keyboardType="numeric"
              className="w-20 text-center text-white font-instrument-semibold text-lg bg-[#121212] border border-[#2A2A2A] rounded-lg py-2"
              selectTextOnFocus
              accessibilityLabel="Number of leads"
            />

            <Pressable
              onPress={increment}
              className="w-10 h-10 rounded-lg flex items-center justify-center bg-[#2A2A2A] active:bg-[#3A3A3A]"
              style={{ width: 40, height: 40 }}
              accessibilityRole="button"
              accessibilityLabel="Increase lead count"
            >
              <PlusIcon size={20} color="#fff" />
            </Pressable>
          </View>
        </View>

        <View className="bg-blue-900/20 border border-blue-800 rounded-lg p-4">
          <Text className="text-blue-400 font-instrument-semibold text-xs mb-2">
            ℹ️ Information:
          </Text>
          <Text className="text-gray-300 font-instrument text-xs mb-1">
            • {leadCount > 0 ? `${leadCount} test lead(s)` : 'Test leads'} will be automatically generated.
          </Text>
          <Text className="text-gray-300 font-instrument text-xs mb-1">
            • Lead emails will follow the pattern: <Text className="font-mono">test-lead-{'{N}'}@furnace.test</Text>
          </Text>
          <Text className="text-gray-300 font-instrument text-xs">
            • Actual email sending will be skipped for these test leads.
          </Text>
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
          accessibilityLabel="Create Test"
        >
          <Text className="text-white font-instrument-semibold text-base">Create Test</Text>
        </Pressable>
      </View>
    </View>
  );
}

