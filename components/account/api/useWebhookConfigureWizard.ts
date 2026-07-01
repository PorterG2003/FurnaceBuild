import { useEffect, useState } from 'react';
import { isValidHttpsWebhookUrl } from '@/lib/client-api/client';
import type { WebhookEventType } from '@/lib/client-api/webhooks/eventGroups';
import {
  WEBHOOK_WIZARD_CLOSE_RESET_DELAY_MS,
  type WebhookWizardStep,
} from './webhookWizardConstants';

export type WebhookFormValues = {
  webhookUrl: string;
  webhookSecret: string;
  enabledEventTypes: WebhookEventType[];
};

export function useWebhookConfigureWizard({
  visible,
  initialValues,
}: {
  visible: boolean;
  initialValues: WebhookFormValues;
}) {
  const [step, setStep] = useState<WebhookWizardStep>(0);
  const [webhookUrl, setWebhookUrl] = useState(initialValues.webhookUrl);
  const [webhookSecret, setWebhookSecret] = useState(initialValues.webhookSecret);
  const [enabledEventTypes, setEnabledEventTypes] = useState<WebhookEventType[]>(
    initialValues.enabledEventTypes,
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (visible) {
      setWebhookUrl(initialValues.webhookUrl);
      setWebhookSecret(initialValues.webhookSecret);
      setEnabledEventTypes(initialValues.enabledEventTypes);
      setStep(0);
    }
  }, [
    visible,
    initialValues.webhookUrl,
    initialValues.webhookSecret,
    initialValues.enabledEventTypes,
  ]);

  useEffect(() => {
    if (visible) return;
    const timer = setTimeout(() => setStep(0), WEBHOOK_WIZARD_CLOSE_RESET_DELAY_MS);
    return () => clearTimeout(timer);
  }, [visible]);

  const validateSetup = (): void => {
    const trimmedUrl = webhookUrl.trim();
    if (trimmedUrl && !isValidHttpsWebhookUrl(trimmedUrl)) {
      throw new Error('Webhook URL must use HTTPS.');
    }
  };

  return {
    step,
    setStep,
    webhookUrl,
    setWebhookUrl,
    webhookSecret,
    setWebhookSecret,
    enabledEventTypes,
    setEnabledEventTypes,
    isSubmitting,
    setIsSubmitting,
    validateSetup,
  };
}
