import { View, Text, Pressable, TextInput } from 'react-native';
import type { FlowTemplate } from '@/lib/test/campaign-flow/types';

interface FlowSelectionStepProps {
  campaignName: string;
  selectedFlow: FlowTemplate;
  onCampaignNameChange: (name: string) => void;
  onFlowChange: (flow: FlowTemplate) => void;
  onNext: () => void;
}

const FLOW_TEMPLATES = [
  { value: 'simple-email', label: 'Simple Email', desc: 'Lead → Email' },
  {
    value: 'email-wait-email',
    label: 'Email + Wait + Email',
    desc: 'Lead → Email → Wait 2 Min → Email (Test)',
  },
  {
    value: 'email-wait-wait-email',
    label: 'Email + Wait + Wait + Email',
    desc: 'Lead → Email → Wait 3 Min → Wait 2 Min → Email (Test)',
  },
] as const;

export function FlowSelectionStep({
  campaignName,
  selectedFlow,
  onCampaignNameChange,
  onFlowChange,
  onNext,
}: FlowSelectionStepProps) {
  return (
    <View>
      <Text className="text-lg font-instrument-semibold text-white mb-4">
        Step 1: Select Flow Template
      </Text>

      <View className="mb-6">
        <Text className="text-gray-300 font-instrument-medium text-sm mb-2">Campaign Name</Text>
        <TextInput
          value={campaignName}
          onChangeText={onCampaignNameChange}
          placeholder="Campaign Flow Test"
          placeholderTextColor="#6b7280"
          className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-lg px-4 py-3 text-white font-instrument"
        />
      </View>

      <View className="mb-6">
        <Text className="text-gray-300 font-instrument-medium text-sm mb-3">Flow Template</Text>
        <View className="gap-3">
          {FLOW_TEMPLATES.map((template) => (
            <Pressable
              key={template.value}
              onPress={() => onFlowChange(template.value as FlowTemplate)}
              className={`rounded-xl p-4 border-2 ${
                selectedFlow === template.value
                  ? 'border-brand-orange bg-brand-orange/10'
                  : 'border-[#2A2A2A] bg-[#1A1A1A]'
              }`}
              style={
                selectedFlow === template.value
                  ? { borderColor: '#f85102', backgroundColor: '#f8510210' }
                  : undefined
              }
              accessibilityRole="button"
              accessibilityLabel={`Select ${template.label} flow template`}
              accessibilityState={{ selected: selectedFlow === template.value }}
            >
              <Text
                className={`font-instrument-semibold text-base mb-1 ${
                  selectedFlow === template.value ? 'text-white' : 'text-gray-300'
                }`}
              >
                {template.label}
              </Text>
              <Text
                className={`font-instrument text-sm ${
                  selectedFlow === template.value ? 'text-gray-300' : 'text-gray-500'
                }`}
              >
                {template.desc}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <Pressable
        onPress={onNext}
        className="bg-brand-orange rounded-xl px-6 py-3 flex-row items-center justify-center"
        style={{ backgroundColor: '#f85102' }}
        accessibilityRole="button"
        accessibilityLabel="Next: Configure Mailboxes"
      >
        <Text className="text-white font-instrument-semibold text-base">Next: Configure Mailboxes</Text>
      </Pressable>
    </View>
  );
}

