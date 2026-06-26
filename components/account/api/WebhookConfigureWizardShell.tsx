import type { ReactNode } from 'react';
import { View, useWindowDimensions } from 'react-native';
import { BaseModal, ModalFooter } from '@/components/ui/modals';
import { WizardStepIndicator } from '@/components/ui/wizard';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/feedback';
import { WebhookSetupStep, type WebhookSetupStepProps } from './WebhookSetupStep';
import { WebhookTestStep } from './WebhookTestStep';
import {
  WEBHOOK_WIZARD_STEP_DESCRIPTIONS,
  WEBHOOK_WIZARD_STEPS,
} from './webhookWizardConstants';
import { useWebhookConfigureWizard } from './useWebhookConfigureWizard';
import type { WebhookFormValues } from './useWebhookConfigureWizard';

export interface WebhookConfigureWizardShellProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  initialValues: WebhookFormValues;
  onPersist: (values: WebhookFormValues) => Promise<void>;
  onSaved?: () => Promise<void> | void;
  savedMessage: (values: WebhookFormValues) => string;
  clearedMessage: string;
  errorMessage: string;
  accountId: string;
  campaignId?: string | null;
  setup: Omit<
    WebhookSetupStepProps,
    | 'webhookUrl'
    | 'onWebhookUrlChange'
    | 'webhookSecret'
    | 'onWebhookSecretChange'
    | 'enabledGroupIds'
    | 'onEnabledGroupIdsChange'
    | 'disabled'
  >;
  setupFooter?: ReactNode | ((values: WebhookFormValues) => ReactNode);
}

export function WebhookConfigureWizardShell({
  visible,
  onClose,
  title,
  initialValues,
  onPersist,
  onSaved,
  savedMessage,
  clearedMessage,
  errorMessage,
  accountId,
  campaignId,
  setup,
  setupFooter,
}: WebhookConfigureWizardShellProps) {
  const { toast } = useToast();
  const { height: windowHeight } = useWindowDimensions();
  const wizard = useWebhookConfigureWizard({ visible, initialValues });

  const currentValues: WebhookFormValues = {
    webhookUrl: wizard.webhookUrl,
    webhookSecret: wizard.webhookSecret,
    enabledGroupIds: wizard.enabledGroupIds,
  };

  const handleDone = async () => {
    wizard.setIsSubmitting(true);
    try {
      wizard.validateSetup();
      await onPersist(currentValues);
      await onSaved?.();
      onClose();
      toast.success(
        wizard.webhookUrl.trim() ? savedMessage(currentValues) : clearedMessage,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : errorMessage);
    } finally {
      wizard.setIsSubmitting(false);
    }
  };

  const handleNext = async () => {
    try {
      wizard.validateSetup();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : errorMessage);
      return;
    }

    if (!wizard.webhookUrl.trim()) {
      toast.error('Enter an HTTPS endpoint URL to continue to testing.');
      return;
    }

    wizard.setStep(1);
  };

  const description =
    wizard.step === 0
      ? WEBHOOK_WIZARD_STEP_DESCRIPTIONS.configure
      : WEBHOOK_WIZARD_STEP_DESCRIPTIONS.test;

  const footer =
    wizard.step === 0 ? (
      <ModalFooter>
        <Button variant="secondary" onPress={onClose} disabled={wizard.isSubmitting}>
          Cancel
        </Button>
        <Button onPress={() => void handleNext()} disabled={wizard.isSubmitting}>
          Next
        </Button>
      </ModalFooter>
    ) : (
      <ModalFooter>
        <Button
          variant="secondary"
          onPress={() => wizard.setStep(0)}
          disabled={wizard.isSubmitting}
        >
          Back
        </Button>
        <Button onPress={() => void handleDone()} disabled={wizard.isSubmitting}>
          {wizard.isSubmitting ? 'Saving…' : 'Done'}
        </Button>
      </ModalFooter>
    );

  const footerMobile =
    wizard.step === 0 ? (
      <ModalFooter>
        <Button onPress={() => void handleNext()} disabled={wizard.isSubmitting}>
          Next
        </Button>
      </ModalFooter>
    ) : (
      <ModalFooter>
        <Button
          variant="secondary"
          onPress={() => wizard.setStep(0)}
          disabled={wizard.isSubmitting}
        >
          Back
        </Button>
        <Button onPress={() => void handleDone()} disabled={wizard.isSubmitting}>
          {wizard.isSubmitting ? 'Saving…' : 'Done'}
        </Button>
      </ModalFooter>
    );

  return (
    <BaseModal
      visible={visible}
      onClose={onClose}
      title={title}
      description={description}
      maxWidth="4xl"
      fitContent
      maxHeight={Math.round(windowHeight * 0.85)}
      footer={footer}
      footerMobile={footerMobile}
    >
      <View className="gap-6">
        <WizardStepIndicator steps={WEBHOOK_WIZARD_STEPS} activeIndex={wizard.step} wrap />

        {wizard.step === 0 ? (
          <WebhookSetupStep
            {...setup}
            webhookUrl={wizard.webhookUrl}
            onWebhookUrlChange={wizard.setWebhookUrl}
            webhookSecret={wizard.webhookSecret}
            onWebhookSecretChange={wizard.setWebhookSecret}
            enabledGroupIds={wizard.enabledGroupIds}
            onEnabledGroupIdsChange={wizard.setEnabledGroupIds}
            disabled={wizard.isSubmitting}
            setupFooter={
              typeof setupFooter === 'function' ? setupFooter(currentValues) : setupFooter
            }
          />
        ) : (
          <WebhookTestStep
            accountId={accountId}
            campaignId={campaignId}
            webhookUrl={wizard.webhookUrl}
            signingSecret={wizard.webhookSecret}
            enabledGroupIds={wizard.enabledGroupIds}
            disabled={wizard.isSubmitting}
          />
        )}
      </View>
    </BaseModal>
  );
}
