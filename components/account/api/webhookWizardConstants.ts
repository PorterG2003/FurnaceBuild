export const WEBHOOK_WIZARD_STEPS = ['Configure', 'Test'] as const;

export type WebhookWizardStep = 0 | 1;

export const WEBHOOK_WIZARD_CLOSE_RESET_DELAY_MS = 180;

export const WEBHOOK_WIZARD_STEP_DESCRIPTIONS = {
  configure: 'Paste your endpoint and choose events.',
  test: 'Send a sample payload to verify delivery.',
} as const;
