import { Platform, useWindowDimensions } from 'react-native';
import { BaseModal, ModalFooter } from '@/components/ui/modals';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/feedback';
import { JsonReadOnlyViewer } from '@/components/ui/forms/JsonReadOnlyViewer';
import { buildWebhookTestSamplePreview } from '@/lib/client-api/webhooks/webhookTestSamples';
import type { WebhookEventType } from '@/lib/client-api/webhooks/webhookEvents';

const NESTED_MODAL_Z_INDEX = 1100;

export interface WebhookSamplePayloadModalProps {
  visible: boolean;
  onClose: () => void;
  eventType: WebhookEventType | null;
  accountId: string;
  campaignId?: string | null;
}

async function copyToClipboard(text: string, toast: ReturnType<typeof useToast>['toast']): Promise<void> {
  if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard.');
    return;
  }
  toast.info('Copy is available on web.');
}

export function WebhookSamplePayloadModal({
  visible,
  onClose,
  eventType,
  accountId,
  campaignId,
}: WebhookSamplePayloadModalProps) {
  const { toast } = useToast();
  const { height: windowHeight } = useWindowDimensions();

  const sampleJson =
    eventType != null
      ? buildWebhookTestSamplePreview(eventType, { accountId, campaignId })
      : '';

  return (
    <BaseModal
      visible={visible && eventType != null}
      onClose={onClose}
      title="Sample payload"
      description={eventType ?? undefined}
      maxWidth="3xl"
      fitContent
      maxHeight={Math.round(windowHeight * 0.75)}
      overlayZIndex={NESTED_MODAL_Z_INDEX}
      footer={
        <ModalFooter>
          <Button variant="secondary" onPress={onClose}>
            Close
          </Button>
          <Button
            onPress={() => void copyToClipboard(sampleJson, toast)}
            disabled={!sampleJson}
          >
            Copy JSON
          </Button>
        </ModalFooter>
      }
      footerMobile={
        <ModalFooter>
          <Button variant="secondary" onPress={onClose}>
            Close
          </Button>
          <Button
            onPress={() => void copyToClipboard(sampleJson, toast)}
            disabled={!sampleJson}
          >
            Copy JSON
          </Button>
        </ModalFooter>
      }
    >
      {sampleJson ? <JsonReadOnlyViewer value={sampleJson} /> : null}
    </BaseModal>
  );
}
