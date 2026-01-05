import type { TestMailbox, ScheduleConfig, SchedulePreset } from './types';

/**
 * Create a default test mailbox
 */
export function createDefaultMailbox(index: number): TestMailbox {
  return {
    id: String(Date.now() + index),
    email_address: `test-mailbox-${index}@furnace.test`,
    display_name: `Test Mailbox ${index}`,
    smtp_host: 'smtp.gmail.com',
    smtp_port: '587',
    smtp_username: `test-mailbox-${index}@furnace.test`,
    smtp_password: 'test-password',
    smtp_use_tls: true,
    smtp_use_ssl: false,
    provider: 'gmail',
  };
}

/**
 * Generate test lead email and name based on index
 */
export function generateTestLead(index: number): { email: string; name: string } {
  return {
    email: `test-lead-${index}@furnace.test`,
    name: `Test Lead ${index}`,
  };
}

/**
 * Validate mailbox configuration
 */
export function validateMailboxes(mailboxes: TestMailbox[]): { valid: boolean; error?: string } {
  if (mailboxes.length === 0) {
    return { valid: false, error: 'Please add at least one mailbox' };
  }

  for (const mailbox of mailboxes) {
    if (!mailbox.email_address || !mailbox.email_address.includes('@')) {
      return {
        valid: false,
        error: `Mailbox ${mailbox.display_name || mailbox.email_address} has invalid email address`,
      };
    }
    if (!mailbox.smtp_host || !mailbox.smtp_port) {
      return {
        valid: false,
        error: `Mailbox ${mailbox.display_name || mailbox.email_address} is missing SMTP configuration`,
      };
    }
  }

  return { valid: true };
}

/**
 * Validate schedule configuration
 */
export function validateSchedule(schedule: ScheduleConfig): { valid: boolean; error?: string } {
  // Compare times: convert to minutes for accurate comparison
  const startMinutes = schedule.start_hour * 60 + schedule.start_minute;
  const endMinutes = schedule.end_hour * 60 + schedule.end_minute;

  if (startMinutes >= endMinutes) {
    return { valid: false, error: 'Start time must be before end time' };
  }

  if (schedule.days_of_week.length === 0) {
    return { valid: false, error: 'Select at least one day of the week' };
  }

  // Validate timezone
  try {
    Intl.DateTimeFormat(undefined, { timeZone: schedule.timezone });
  } catch (e) {
    return { valid: false, error: `Invalid timezone: ${schedule.timezone}` };
  }

  return { valid: true };
}

/**
 * Apply schedule preset
 */
export function applySchedulePreset(preset: SchedulePreset): ScheduleConfig {
  if (preset === '24/7') {
    return {
      timezone: 'America/New_York',
      start_hour: 0,
      start_minute: 0,
      end_hour: 23,
      end_minute: 55, // Last 5-minute increment
      days_of_week: [0, 1, 2, 3, 4, 5, 6], // All days
    };
  } else if (preset === 'business-hours') {
    return {
      timezone: 'America/New_York',
      start_hour: 9,
      start_minute: 0,
      end_hour: 17,
      end_minute: 0,
      days_of_week: [1, 2, 3, 4, 5], // Mon-Fri
    };
  } else if (preset === 'weekdays-only') {
    return {
      timezone: 'America/New_York',
      start_hour: 0,
      start_minute: 0,
      end_hour: 23,
      end_minute: 55, // Last 5-minute increment
      days_of_week: [1, 2, 3, 4, 5], // Mon-Fri
    };
  }

  // Default fallback
  return {
    timezone: 'America/New_York',
    start_hour: 9,
    start_minute: 0,
    end_hour: 17,
    end_minute: 0,
    days_of_week: [1, 2, 3, 4, 5],
  };
}

