import type { SmartleadMigrationRun } from '@/lib/supabase/types';

export const STEPS = ['API Key', 'Campaigns', 'Migrate', 'Review'] as const;

export const ACTIVE_RUN_STATUSES: SmartleadMigrationRun['status'][] = [
  'queued',
  'launch_requested',
  'task_started',
  'running',
  'cancel_requested',
];

export const CLOSE_RESET_DELAY_MS = 180;
export const REVIEW_PAGE_SIZE = 25;

export const STATUS_STYLES: Record<string, { bg: string; border: string; text: string }> = {
  ACTIVE: { bg: 'bg-green-500/15', border: 'border-green-500/30', text: 'text-green-400' },
  COMPLETED: { bg: 'bg-blue-500/15', border: 'border-blue-500/30', text: 'text-blue-400' },
  STOPPED: { bg: 'bg-red-500/15', border: 'border-red-500/30', text: 'text-red-400' },
  PAUSED: { bg: 'bg-orange-500/15', border: 'border-orange-500/30', text: 'text-orange-400' },
  DRAFTED: { bg: 'bg-gray-500/15', border: 'border-gray-500/25', text: 'text-gray-400' },
};

export const DEFAULT_STATUS_STYLE = {
  bg: 'bg-gray-500/15',
  border: 'border-gray-500/25',
  text: 'text-gray-400',
};
