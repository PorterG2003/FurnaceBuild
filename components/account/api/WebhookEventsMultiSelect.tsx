import { View } from 'react-native';
import { SearchAndSelectMulti, type FormFieldVariant } from '@/components/ui/forms';
import {
  WEBHOOK_EVENT_SELECT_ITEMS,
  WEBHOOK_EVENT_OPTIONS,
  type WebhookEventOption,
} from './constants';

export interface WebhookEventsMultiSelectProps {
  value: WebhookEventOption[];
  onChange: (events: WebhookEventOption[]) => void;
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
  placeholder = 'Select events…',
  disabled = false,
  variant = 'solid',
}: WebhookEventsMultiSelectProps) {
  return (
    <View style={disabled ? { opacity: 0.5, pointerEvents: 'none' } : undefined}>
      <SearchAndSelectMulti
        variant={variant}
        label={label}
        labelHelp={labelHelp}
        items={WEBHOOK_EVENT_SELECT_ITEMS}
        getItemId={(item) => item.value}
        getItemLabel={(item) => item.label}
        value={value}
        onChange={(ids) =>
          onChange(
            ids.filter((id): id is WebhookEventOption =>
              WEBHOOK_EVENT_OPTIONS.includes(id as WebhookEventOption)
            )
          )
        }
        placeholder={placeholder}
        searchPlaceholder="Search events…"
        emptyMessage={(hasSearch) => (hasSearch ? 'No matching events' : 'No events')}
        listMaxHeight={260}
        noMargin
      />
    </View>
  );
}
