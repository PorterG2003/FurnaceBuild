import { View } from 'react-native';
import { SearchAndSelectMulti, type FormFieldVariant } from '@/components/ui/forms';
import { WEBHOOK_EVENT_GROUP_ITEMS } from './constants';

export interface WebhookEventsMultiSelectProps {
  value: string[];
  onChange: (groupIds: string[]) => void;
  label?: string;
  labelHelp?: string;
  placeholder?: string;
  disabled?: boolean;
  variant?: FormFieldVariant;
}

export function WebhookEventsMultiSelect({
  value,
  onChange,
  label = 'Enabled events',
  labelHelp,
  placeholder = 'Select event groups…',
  disabled = false,
  variant = 'solid',
}: WebhookEventsMultiSelectProps) {
  return (
    <View style={disabled ? { opacity: 0.5, pointerEvents: 'none' } : undefined}>
      <SearchAndSelectMulti
        variant={variant}
        label={label}
        labelHelp={labelHelp}
        items={WEBHOOK_EVENT_GROUP_ITEMS}
        getItemId={(item) => item.value}
        getItemLabel={(item) => item.label}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        searchPlaceholder="Search event groups…"
        emptyMessage={(hasSearch) => (hasSearch ? 'No matching groups' : 'No event groups')}
        listMaxHeight={260}
        noMargin
      />
    </View>
  );
}
