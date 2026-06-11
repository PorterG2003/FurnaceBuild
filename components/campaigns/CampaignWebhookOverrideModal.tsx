import { useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { BaseModal, ModalFooter } from '@/components/ui/modals';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/feedback';
import { FormTextField } from '@/components/ui/forms';
import {
  parseWebhookGroupIds,
  webhookEventsFromGroupIds,
} from '@/components/account/api/constants';
import { WebhookEventsMultiSelect } from '@/components/account/api/WebhookEventsMultiSelect';
import { CAMPAIGN_WEBHOOK_FIELD_HELP } from '@/components/account/api/webhookFieldHelp';
import type { Campaign } from '@/lib/supabase/types';
import { updateCampaign } from '@/lib/supabase/services/campaigns';
import { verifyWebhookUrl } from '@/lib/client-api/client';

export interface CampaignWebhookOverrideModalProps {
  visible: boolean;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
  campaign: Campaign | null;
}

export function CampaignWebhookOverrideModal({
  visible,
  onClose,
  onSaved,
  campaign,
}: CampaignWebhookOverrideModalProps) {
  const { toast } = useToast();
  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [enabledGroupIds, setEnabledGroupIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible && campaign) {
      setWebhookUrl(campaign.webhook_url_override ?? '');
      setWebhookSecret(campaign.webhook_signing_secret_override ?? '');
      setEnabledGroupIds(parseWebhookGroupIds(campaign.webhook_enabled_events_override));
    }
  }, [
    visible,
    campaign,
  ]);

  const inheritsAccountDefault = useMemo(() => !webhookUrl.trim(), [webhookUrl]);

  const handleSave = async () => {
    if (!campaign) return;
    setSaving(true);
    try {
      const trimmedUrl = webhookUrl.trim();
      let verifiedAt: string | null = null;
      if (trimmedUrl) {
        const verifyResult = await verifyWebhookUrl({
          accountId: campaign.account_id ?? '',
          campaignId: campaign.id,
          url: trimmedUrl,
        });
        if (!verifyResult.verified) {
          throw new Error('Webhook URL verification failed. The endpoint must echo the verification token in the response body.');
        }
        verifiedAt = new Date().toISOString();
      }
      await updateCampaign(campaign.id, {
        webhook_url_override: trimmedUrl || null,
        webhook_signing_secret_override: webhookSecret.trim() || null,
        webhook_enabled_events_override: enabledGroupIds.length > 0
          ? webhookEventsFromGroupIds(enabledGroupIds)
          : null,
        webhook_url_override_verified_at: verifiedAt,
      });
      await onSaved();
      onClose();
      toast.success(trimmedUrl ? 'Campaign webhook override saved.' : 'Campaign webhook override cleared.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save campaign webhook override.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <BaseModal
      visible={visible}
      onClose={onClose}
      title="Webhook override"
      description="Leave the URL empty to inherit the account-level webhook. Saving verifies the campaign URL before the override is stored."
      maxWidth="md"
      footer={
        <ModalFooter>
          <Button variant="secondary" onPress={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onPress={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </ModalFooter>
      }
      footerMobile={
        <ModalFooter>
          <Button onPress={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </ModalFooter>
      }
    >
      <View className="gap-4">
        <FormTextField
          label="Override URL"
          labelHelp={CAMPAIGN_WEBHOOK_FIELD_HELP.overrideUrl}
          value={webhookUrl}
          onChangeText={setWebhookUrl}
          placeholder="https://example.com/furnace/webhook"
          autoCapitalize="none"
          editable={!saving}
          variant="solid"
        />
        <FormTextField
          label="Override signing secret"
          labelHelp={CAMPAIGN_WEBHOOK_FIELD_HELP.overrideSigningSecret}
          value={webhookSecret}
          onChangeText={setWebhookSecret}
          placeholder="whsec_..."
          autoCapitalize="none"
          editable={!saving}
          variant="solid"
        />
        <View>
          <WebhookEventsMultiSelect
            label="Override events"
            labelHelp={CAMPAIGN_WEBHOOK_FIELD_HELP.overrideEvents}
            value={enabledGroupIds}
            onChange={setEnabledGroupIds}
            placeholder="Inherit account events when empty"
            disabled={saving}
            variant="solid"
          />
          <Text className="text-xs text-gray-500 mt-2 font-instrument">
            {inheritsAccountDefault
              ? 'Campaign currently inherits the account default URL and events.'
              : 'Campaign sends matching events to its own verified override URL.'}
          </Text>
        </View>
      </View>
    </BaseModal>
  );
}

export default CampaignWebhookOverrideModal;
