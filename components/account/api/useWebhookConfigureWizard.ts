import { useEffect, useState } from 'react';
import { isValidHttpsWebhookUrl } from '@/lib/client-api/client';
import {
  WEBHOOK_WIZARD_CLOSE_RESET_DELAY_MS,
  type WebhookWizardStep,
} from './webhookWizardConstants';

export type WebhookFormValues = {
  webhookUrl: string;
  webhookSecret: string;
  enabledGroupIds: string[];
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
  const [enabledGroupIds, setEnabledGroupIds] = useState<string[]>(initialValues.enabledGroupIds);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (visible) {
      setWebhookUrl(initialValues.webhookUrl);
      setWebhookSecret(initialValues.webhookSecret);
      setEnabledGroupIds(initialValues.enabledGroupIds);
      setStep(0);
    }
  }, [
    visible,
    initialValues.webhookUrl,
    initialValues.webhookSecret,
    initialValues.enabledGroupIds,
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
    enabledGroupIds,
    setEnabledGroupIds,
    isSubmitting,
    setIsSubmitting,
    validateSetup,
  };
}
