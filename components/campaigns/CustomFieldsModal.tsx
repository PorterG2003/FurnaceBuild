import { View, Text } from 'react-native';
import { BaseModal } from '@/components/ui/modals/BaseModal';

interface LeadWithCustom {
  email: string;
  custom_lead_data?: Record<string, unknown> | null;
}

interface CustomFieldsModalProps {
  visible: boolean;
  onClose: () => void;
  lead: LeadWithCustom | null;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function CustomFieldsModal({ visible, onClose, lead }: CustomFieldsModalProps) {
  const data = lead?.custom_lead_data;
  const entries =
    data && typeof data === 'object' && !Array.isArray(data)
      ? Object.entries(data)
      : [];

  return (
    <BaseModal
      visible={visible}
      onClose={onClose}
      title="Custom fields"
      description={lead ? `Custom data for ${lead.email}` : undefined}
      maxWidth="md"
      maxHeight={480}
    >
      {entries.length === 0 ? (
        <Text className="text-gray-400 font-instrument text-sm">No custom fields.</Text>
      ) : (
        <View className="gap-2">
          {entries.map(([key, value]) => (
            <View
              key={key}
              className="border-b border-[#2A2A2A] pb-2"
              style={{ borderStyle: 'solid' }}
            >
              <Text className="text-gray-500 font-instrument text-xs uppercase tracking-wide">
                {key}
              </Text>
              <Text
                className="text-white font-instrument text-sm mt-0.5 break-all"
                selectable
              >
                {formatValue(value)}
              </Text>
            </View>
          ))}
        </View>
      )}
    </BaseModal>
  );
}
