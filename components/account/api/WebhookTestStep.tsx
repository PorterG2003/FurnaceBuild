import { useCallback, useEffect, useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/feedback';
import { InlineOptionList } from '@/components/ui/forms';
import { sendTestWebhook } from '@/lib/client-api/client';
import {
  curatedWebhookTestEventOptions,
  defaultWebhookTestEventType,
} from '@/lib/client-api/webhooks/webhookTestSamples';
import type { WebhookEventType } from '@/lib/client-api/webhooks/webhookEvents';
import { WebhookSamplePayloadModal } from './WebhookSamplePayloadModal';

export interface WebhookTestStepProps {
  accountId: string;
  campaignId?: string | null;
  webhookUrl: string;
  signingSecret: string;
  enabledEventTypes: WebhookEventType[];
  disabled?: boolean;
}

async function copyToClipboard(text: string, toast: ReturnType<typeof useToast>['toast']): Promise<void> {
  if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard.');
    return;
  }
  toast.info('Copy is available on web.');
}

export function WebhookTestStep({
  accountId,
  campaignId,
  webhookUrl,
  signingSecret,
  enabledEventTypes,
  disabled = false,
}: WebhookTestStepProps) {
  const { toast } = useToast();
  const [testEventType, setTestEventType] = useState<WebhookEventType>('email.sent');
  const [samplePreviewEventType, setSamplePreviewEventType] = useState<WebhookEventType | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    status: number;
    response_body: string;
  } | null>(null);

  const testEventOptions = curatedWebhookTestEventOptions(enabledEventTypes);

  useEffect(() => {
    setTestEventType(defaultWebhookTestEventType(enabledEventTypes));
  }, [enabledEventTypes]);

  useEffect(() => {
    if (!testEventOptions.some((option) => option.value === testEventType)) {
      setTestEventType(testEventOptions[0]?.value ?? 'email.sent');
    }
  }, [testEventOptions, testEventType]);

  const canTest = webhookUrl.trim().length > 0 && !disabled;

  const handleSendTest = useCallback(async () => {
    if (!webhookUrl.trim() || disabled) return;
    setTesting(true);
    setTestResult(null);
    try {
      const result = await sendTestWebhook({
        accountId,
        campaignId,
        url: webhookUrl.trim(),
        signingSecret: signingSecret.trim() || undefined,
        eventType: testEventType,
      });
      setTestResult(result);
    } catch (error) {
      setTestResult({
        success: false,
        status: 0,
        response_body: error instanceof Error ? error.message : 'Test webhook failed.',
      });
    } finally {
      setTesting(false);
    }
  }, [accountId, campaignId, disabled, signingSecret, testEventType, webhookUrl]);

  return (
    <View className="gap-4">
      <Text className="text-xs text-gray-500 font-instrument leading-5">
        Send a sample POST to your endpoint. You can test before saving.
      </Text>

      <InlineOptionList
        label="Event type"
        items={testEventOptions}
        getItemId={(item) => item.value}
        getItemLabel={(item) => item.label}
        getItemSecondaryLabel={(item) => item.groupLabel}
        selectionMode="single"
        value={testEventType}
        onChange={(id) => setTestEventType(id as WebhookEventType)}
        disabled={disabled}
        noMargin
        renderRowAccessory={(item) => (
          <Button
            variant="secondary"
            size="xs"
            onPress={() => setSamplePreviewEventType(item.value)}
            disabled={disabled}
          >
            View sample
          </Button>
        )}
      />

      <Button onPress={() => void handleSendTest()} disabled={!canTest || testing}>
        {testing ? 'Sending…' : 'Send test webhook'}
      </Button>

      {testResult ? (
        <View className="rounded-xl border border-[#2A2A2A] bg-[#121212] px-3 py-2.5">
          <View className="flex-row items-center justify-between gap-2">
            <Text
              className={`text-xs font-instrument-semibold flex-1 ${testResult.success ? 'text-green-400' : 'text-red-300'}`}
            >
              {testResult.success ? 'Delivered' : 'Failed'}
              {testResult.status > 0 ? ` · HTTP ${testResult.status}` : ''}
            </Text>
            <Button
              variant="secondary"
              size="xs"
              onPress={() => void copyToClipboard(testResult.response_body, toast)}
            >
              Copy response
            </Button>
          </View>
          {testResult.response_body ? (
            <Text selectable className="text-[11px] text-gray-400 font-mono leading-4 mt-2" numberOfLines={4}>
              {testResult.response_body}
            </Text>
          ) : null}
        </View>
      ) : null}

      <WebhookSamplePayloadModal
        visible={samplePreviewEventType != null}
        onClose={() => setSamplePreviewEventType(null)}
        eventType={samplePreviewEventType}
        accountId={accountId}
        campaignId={campaignId}
      />
    </View>
  );
}
