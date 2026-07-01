import type { ReactNode } from 'react';
import { View } from 'react-native';
import type { WebhookEventType } from '@/lib/client-api/webhooks/eventGroups';
import { FormTextField } from '@/components/ui/forms';
import { WebhookEventsGroupedSelect } from './WebhookEventsGroupedSelect';

export interface WebhookSetupStepProps {
  endpointLabel: string;
  endpointHelp: string;
  endpointPlaceholder?: string;
  eventsLabel?: string;
  eventsHelp?: string;
  secretLabel: string;
  secretHelp: string;
  secretPlaceholder?: string;
  webhookUrl: string;
  onWebhookUrlChange: (value: string) => void;
  webhookSecret: string;
  onWebhookSecretChange: (value: string) => void;
  enabledEventTypes: WebhookEventType[];
  onEnabledEventTypesChange: (eventTypes: WebhookEventType[]) => void;
  disabled?: boolean;
  setupFooter?: ReactNode;
}

export function WebhookSetupStep({
  endpointLabel,
  endpointHelp,
  endpointPlaceholder = 'https://example.com/furnace/webhook',
  eventsLabel = 'Enabled events',
  eventsHelp,
  secretLabel,
  secretHelp,
  secretPlaceholder = 'whsec_...',
  webhookUrl,
  onWebhookUrlChange,
  webhookSecret,
  onWebhookSecretChange,
  enabledEventTypes,
  onEnabledEventTypesChange,
  disabled = false,
  setupFooter,
}: WebhookSetupStepProps) {
  return (
    <View className="gap-4">
      <FormTextField
        label={endpointLabel}
        labelHelp={endpointHelp}
        value={webhookUrl}
        onChangeText={onWebhookUrlChange}
        placeholder={endpointPlaceholder}
        autoCapitalize="none"
        autoCorrect={false}
        editable={!disabled}
        variant="solid"
      />

      <FormTextField
        label={secretLabel}
        labelHelp={secretHelp}
        value={webhookSecret}
        onChangeText={onWebhookSecretChange}
        placeholder={secretPlaceholder}
        autoCapitalize="none"
        editable={!disabled}
        variant="solid"
      />

      <WebhookEventsGroupedSelect
        label={eventsLabel}
        labelHelp={eventsHelp}
        value={enabledEventTypes}
        onChange={onEnabledEventTypesChange}
        disabled={disabled}
        variant="solid"
      />

      {setupFooter}
    </View>
  );
}
