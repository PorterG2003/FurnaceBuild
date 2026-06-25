import { useEffect, useMemo, useState } from 'react';
import { Text } from 'react-native';
import {
  parseWebhookGroupIds,
  webhookEventsFromGroupIds,
} from '@/components/account/api/constants';
import { WebhookConfigureWizardShell } from '@/components/account/api/WebhookConfigureWizardShell';
import { CAMPAIGN_WEBHOOK_FIELD_HELP } from '@/components/account/api/webhookFieldHelp';
import type { WebhookFormValues } from '@/components/account/api/useWebhookConfigureWizard';
import type { Campaign } from '@/lib/supabase/types';
import { updateCampaign } from '@/lib/supabase/services/campaigns';

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
  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [enabledGroupIds, setEnabledGroupIds] = useState<string[]>([]);

  useEffect(() => {
    if (visible && campaign) {
      setWebhookUrl(campaign.webhook_url_override ?? '');
      setWebhookSecret(campaign.webhook_signing_secret_override ?? '');
      setEnabledGroupIds(parseWebhookGroupIds(campaign.webhook_enabled_events_override));
    }
  }, [visible, campaign]);

  const initialValues = useMemo(
    (): WebhookFormValues => ({
      webhookUrl,
      webhookSecret,
      enabledGroupIds,
    }),
    [webhookUrl, webhookSecret, enabledGroupIds],
  );

  if (!campaign) return null;

  const handlePersist = async (values: WebhookFormValues) => {
    await updateCampaign(campaign.id, {
      webhook_url_override: values.webhookUrl.trim() || null,
      webhook_signing_secret_override: values.webhookSecret.trim() || null,
      webhook_enabled_events_override:
        values.enabledGroupIds.length > 0
          ? webhookEventsFromGroupIds(values.enabledGroupIds)
          : null,
    });
  };

  return (
    <WebhookConfigureWizardShell
      visible={visible}
      onClose={onClose}
      title="Webhook override"
      initialValues={initialValues}
      onPersist={handlePersist}
      onSaved={onSaved}
      savedMessage={() => 'Campaign webhook override saved.'}
      clearedMessage="Campaign webhook override cleared."
      errorMessage="Failed to save campaign webhook override."
      accountId={campaign.account_id ?? ''}
      campaignId={campaign.id}
      setup={{
        endpointLabel: 'Override URL',
        endpointHelp: CAMPAIGN_WEBHOOK_FIELD_HELP.overrideUrl,
        eventsLabel: 'Override events',
        eventsHelp: CAMPAIGN_WEBHOOK_FIELD_HELP.overrideEvents,
        secretLabel: 'Override signing secret',
        secretHelp: CAMPAIGN_WEBHOOK_FIELD_HELP.overrideSigningSecret,
      }}
      setupFooter={(values) => {
        const inherits = !values.webhookUrl.trim();
        return (
          <Text className="text-xs text-gray-500 font-instrument leading-5">
            {inherits
              ? 'Campaign currently inherits the account default URL and events.'
              : 'Campaign sends matching events to its own override URL.'}
          </Text>
        );
      }}
    />
  );
}

export default CampaignWebhookOverrideModal;
