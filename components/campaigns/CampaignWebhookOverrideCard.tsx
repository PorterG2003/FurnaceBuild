import { useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/Card';
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

interface CampaignWebhookOverrideCardProps {
  campaign: Campaign;
  onSaved: () => Promise<void> | void;
}

export function CampaignWebhookOverrideCard({
  campaign,
  onSaved,
}: CampaignWebhookOverrideCardProps) {
  const { toast } = useToast();
  const [webhookUrl, setWebhookUrl] = useState(campaign.webhook_url_override ?? '');
  const [webhookSecret, setWebhookSecret] = useState(campaign.webhook_signing_secret_override ?? '');
  const [enabledGroupIds, setEnabledGroupIds] = useState<string[]>(() =>
    parseWebhookGroupIds(campaign.webhook_enabled_events_override)
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setEnabledGroupIds(parseWebhookGroupIds(campaign.webhook_enabled_events_override));
  }, [campaign.id, campaign.webhook_enabled_events_override]);

  const inheritsAccountDefault = useMemo(() => !webhookUrl.trim(), [webhookUrl]);

  const handleSave = async () => {
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
      toast.success(trimmedUrl ? 'Campaign webhook override saved.' : 'Campaign webhook override cleared.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save campaign webhook override.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card variant="card" className="mb-6 p-5">
      <Text className="text-lg font-instrument-semibold text-white pb-2 mb-4 border-b border-[#2A2A2A]">
        Webhook Override
      </Text>
      <Text className="text-xs text-gray-500 mb-4">
        Leave the URL empty to inherit the account-level webhook. Saving verifies the campaign URL before the override is stored.
      </Text>
      <FormTextField
        label="Override URL"
        labelHelp={CAMPAIGN_WEBHOOK_FIELD_HELP.overrideUrl}
        value={webhookUrl}
        onChangeText={setWebhookUrl}
        placeholder="https://example.com/furnace/webhook"
        autoCapitalize="none"
        variant="solid"
        containerClassName="mb-3"
      />
      <FormTextField
        label="Override signing secret"
        labelHelp={CAMPAIGN_WEBHOOK_FIELD_HELP.overrideSigningSecret}
        value={webhookSecret}
        onChangeText={setWebhookSecret}
        placeholder="whsec_..."
        autoCapitalize="none"
        variant="solid"
        containerClassName="mb-3"
      />
      <View className="mb-4">
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
      <Button onPress={handleSave} disabled={saving}>
        {saving ? 'Saving...' : inheritsAccountDefault ? 'Save Override Settings' : 'Save Verified Override'}
      </Button>
    </Card>
  );
}

export default CampaignWebhookOverrideCard;
