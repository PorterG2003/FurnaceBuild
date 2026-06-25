import { useMemo } from 'react';
import type { Account } from '@/lib/supabase/types';
import { updateAccountWebhookSettings } from '@/lib/supabase/services/accounts';
import { parseWebhookGroupIds, webhookEventsFromGroupIds } from './constants';
import { WebhookConfigureWizardShell } from './WebhookConfigureWizardShell';
import { ACCOUNT_WEBHOOK_FIELD_HELP } from './webhookFieldHelp';
import type { WebhookFormValues } from './useWebhookConfigureWizard';

export interface ConfigureWebhookModalProps {
  visible: boolean;
  onClose: () => void;
  account: Account;
  onSaved: () => Promise<void> | void;
}

export function ConfigureWebhookModal({
  visible,
  onClose,
  account,
  onSaved,
}: ConfigureWebhookModalProps) {
  const initialValues = useMemo(
    (): WebhookFormValues => ({
      webhookUrl: account.webhook_url ?? '',
      webhookSecret: account.webhook_signing_secret ?? '',
      enabledGroupIds: parseWebhookGroupIds(account.webhook_enabled_events),
    }),
    [
      account.webhook_url,
      account.webhook_signing_secret,
      account.webhook_enabled_events,
    ],
  );

  const handlePersist = async (values: WebhookFormValues) => {
    await updateAccountWebhookSettings(account.id, {
      webhook_url: values.webhookUrl.trim() || null,
      webhook_signing_secret: values.webhookSecret.trim() || null,
      webhook_enabled_events: webhookEventsFromGroupIds(values.enabledGroupIds),
    });
  };

  return (
    <WebhookConfigureWizardShell
      visible={visible}
      onClose={onClose}
      title="Configure webhook"
      initialValues={initialValues}
      onPersist={handlePersist}
      onSaved={onSaved}
      savedMessage={() => 'Webhook settings saved.'}
      clearedMessage="Webhook settings cleared."
      errorMessage="Failed to save webhook settings."
      accountId={account.id}
      setup={{
        endpointLabel: 'Endpoint URL',
        endpointHelp: ACCOUNT_WEBHOOK_FIELD_HELP.endpointUrl,
        eventsHelp: ACCOUNT_WEBHOOK_FIELD_HELP.enabledEvents,
        secretLabel: 'Signing secret',
        secretHelp: ACCOUNT_WEBHOOK_FIELD_HELP.signingSecret,
      }}
    />
  );
}
