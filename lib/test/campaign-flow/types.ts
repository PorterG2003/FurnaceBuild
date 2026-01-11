export type WizardStep = 'flow' | 'mailbox' | 'schedule' | 'lead' | 'processing' | 'complete';

export type FlowTemplate = 'simple-email' | 'email-wait-email' | 'email-wait-wait-email';

export interface ScheduleConfig {
  timezone: string;
  start_hour: number;
  start_minute: number;
  end_hour: number;
  end_minute: number;
  days_of_week: number[];
  sending_interval_seconds: number;
}

export type SchedulePreset = '24/7' | 'business-hours' | 'weekdays-only' | 'custom';
