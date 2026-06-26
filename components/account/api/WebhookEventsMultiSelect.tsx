import { InlineOptionList, type FormFieldVariant } from '@/components/ui/forms';
import { WEBHOOK_EVENT_GROUP_ITEMS } from './constants';

export interface WebhookEventsMultiSelectProps {
  value: string[];
  onChange: (groupIds: string[]) => void;
  label?: string;
  labelHelp?: string;
  disabled?: boolean;
  variant?: FormFieldVariant;
}

export function WebhookEventsMultiSelect({
  value,
  onChange,
  label = 'Enabled events',
  labelHelp,
  disabled = false,
  variant = 'solid',
}: WebhookEventsMultiSelectProps) {
  return (
    <InlineOptionList
      variant={variant}
      label={label}
      labelHelp={labelHelp}
      items={WEBHOOK_EVENT_GROUP_ITEMS}
      getItemId={(item) => item.value}
      getItemLabel={(item) => item.label}
      getItemSecondaryLabel={(item) => item.description}
      selectionMode="multi"
      value={value}
      onChange={onChange}
      disabled={disabled}
      noMargin
    />
  );
}
