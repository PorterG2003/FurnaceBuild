import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { BaseModal, ModalFooter } from '@/components/ui/modals';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/feedback';
import { FormTextField } from '@/components/ui/forms';
import type { Account } from '@/lib/supabase/types';
import { updateAccountWebhookSettings } from '@/lib/supabase/services/accounts';
import { verifyWebhookUrl } from '@/lib/client-api/client';
import { parseWebhookGroupIds, webhookEventsFromGroupIds } from './constants';
import { WebhookEventsMultiSelect } from './WebhookEventsMultiSelect';
import { ACCOUNT_WEBHOOK_FIELD_HELP } from './webhookFieldHelp';

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
  const { toast } = useToast();
  const [webhookUrl, setWebhookUrl] = useState(account.webhook_url ?? '');
  const [webhookSecret, setWebhookSecret] = useState(account.webhook_signing_secret ?? '');
  const [enabledGroupIds, setEnabledGroupIds] = useState<string[]>(() =>
    parseWebhookGroupIds(account.webhook_enabled_events)
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (visible) {
      setWebhookUrl(account.webhook_url ?? '');
      setWebhookSecret(account.webhook_signing_secret ?? '');
      setEnabledGroupIds(parseWebhookGroupIds(account.webhook_enabled_events));
    }
  }, [
    visible,
    account.id,
    account.webhook_url,
    account.webhook_signing_secret,
    account.webhook_enabled_events,
  ]);

  const handleSave = async () => {
    setIsSubmitting(true);
    try {
      const trimmedUrl = webhookUrl.trim();
      let verifiedAt: string | null = null;
      if (trimmedUrl) {
        const verifyResult = await verifyWebhookUrl({
          accountId: account.id,
          url: trimmedUrl,
        });
        if (!verifyResult.verified) {
          throw new Error(
            'Webhook URL verification failed. The endpoint must echo the verification token in the response body.'
          );
        }
        verifiedAt = new Date().toISOString();
      }
      await updateAccountWebhookSettings(account.id, {
        webhook_url: trimmedUrl || null,
        webhook_signing_secret: webhookSecret.trim() || null,
        webhook_enabled_events: webhookEventsFromGroupIds(enabledGroupIds),
        webhook_url_verified_at: verifiedAt,
      });
      await onSaved();
      onClose();
      toast.success(trimmedUrl ? 'Webhook settings saved and verified.' : 'Webhook settings cleared.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save webhook settings.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <BaseModal
      visible={visible}
      onClose={onClose}
      title="Configure webhook"
      description="Save runs a verification challenge before the URL is persisted. Leave the URL empty to disable the account webhook."
      maxWidth="md"
      footer={
        <ModalFooter>
          <Button variant="secondary" onPress={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onPress={handleSave} disabled={isSubmitting}>
            {isSubmitting ? 'Saving…' : 'Save'}
          </Button>
        </ModalFooter>
      }
      footerMobile={
        <ModalFooter>
          <Button onPress={handleSave} disabled={isSubmitting}>
            {isSubmitting ? 'Saving…' : 'Save'}
          </Button>
        </ModalFooter>
      }
    >
      <View className="gap-4">
        <FormTextField
          label="Endpoint URL"
          labelHelp={ACCOUNT_WEBHOOK_FIELD_HELP.endpointUrl}
          value={webhookUrl}
          onChangeText={setWebhookUrl}
          placeholder="https://example.com/furnace/webhook"
          autoCapitalize="none"
          editable={!isSubmitting}
          variant="solid"
        />
        <FormTextField
          label="Signing secret"
          labelHelp={ACCOUNT_WEBHOOK_FIELD_HELP.signingSecret}
          value={webhookSecret}
          onChangeText={setWebhookSecret}
          placeholder="whsec_..."
          autoCapitalize="none"
          editable={!isSubmitting}
          variant="solid"
        />
        <WebhookEventsMultiSelect
          value={enabledGroupIds}
          onChange={setEnabledGroupIds}
          labelHelp={ACCOUNT_WEBHOOK_FIELD_HELP.enabledEvents}
          disabled={isSubmitting}
          variant="solid"
        />
      </View>
    </BaseModal>
  );
}
