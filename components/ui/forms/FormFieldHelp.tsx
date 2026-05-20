import { Alert, Platform, Pressable, Text, View } from 'react-native';
import { InformationCircleIcon } from 'react-native-heroicons/outline';
import { Tooltip } from '@/components/ui/Tooltip';

function HelpTooltipBody({ text }: { text: string }) {
  return (
    <Text className="text-gray-300 font-instrument text-xs leading-5" style={{ maxWidth: 280 }}>
      {text}
    </Text>
  );
}

export interface FormFieldHelpIconProps {
  content: string;
  accessibilityLabel?: string;
}

export function FormFieldHelpIcon({ content, accessibilityLabel }: FormFieldHelpIconProps) {
  const a11yLabel = accessibilityLabel ?? 'Help';

  if (Platform.OS === 'web') {
    return (
      <Tooltip content={<HelpTooltipBody text={content} />} placement="top">
        <Pressable
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={a11yLabel}
          className="shrink-0"
        >
          <InformationCircleIcon size={16} color="#9CA3AF" />
        </Pressable>
      </Tooltip>
    );
  }

  return (
    <Pressable
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      onPress={() => Alert.alert(a11yLabel, content)}
      className="shrink-0"
    >
      <InformationCircleIcon size={16} color="#9CA3AF" />
    </Pressable>
  );
}

export interface FormFieldLabelProps {
  label: string;
  /** Full label class from `FORM_FIELD_VARIANTS` (may include `mb-2`). */
  labelClassName: string;
  help?: string;
}

export function FormFieldLabel({ label, labelClassName, help }: FormFieldLabelProps) {
  const labelTextClassName = labelClassName.replace(/\bmb-\d+\b/g, '').trim();

  if (!help) {
    return (
      <Text selectable={false} className={labelClassName}>
        {label}
      </Text>
    );
  }

  return (
    <View className="flex-row items-center gap-1.5 mb-2">
      <Text selectable={false} className={labelTextClassName}>
        {label}
      </Text>
      <FormFieldHelpIcon content={help} accessibilityLabel={`Help for ${label}`} />
    </View>
  );
}
