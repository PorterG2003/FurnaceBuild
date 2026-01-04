export interface StepStatus {
  status: 'pending' | 'loading' | 'success' | 'error';
  message?: string;
}

export type WizardStep = 'flow' | 'lead' | 'processing' | 'complete';

export type FlowTemplate = 'simple-email' | 'email-wait-email' | 'email-wait-wait-email' | 'custom';

export type TestStatus = 'created' | 'processing' | 'waiting' | 'running' | 'complete' | 'error';

export type ActiveTab = 'overview' | 'progress' | 'details' | 'diagnostics';

