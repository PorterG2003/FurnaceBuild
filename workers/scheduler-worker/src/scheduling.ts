import type { Enrollment, CampaignSchedule } from './types.js';

/**
 * Calculate when the message should be scheduled to send
 * Placeholder implementation - will be enhanced in Phase 3.1
 */
export function calculateScheduledAt(enrollment: Enrollment, schedule: CampaignSchedule | null): string {
  // Placeholder implementation
  // This should:
  // - Respect campaign schedule (timezone, hours, days_of_week)
  // - Apply jitter (random delay)
  // - Handle business hours
  
  // For now, schedule immediately
  return new Date().toISOString();
}

