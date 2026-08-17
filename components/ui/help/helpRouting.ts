export type HelpAccountManager = 'porter' | 'kyle';
export type HelpTopic = 'technical' | 'strategy';

export type HelpContact = {
  id: HelpAccountManager;
  name: string;
  email: string;
  scheduleUrl: string;
};

export const HELP_CONTACTS: Record<HelpAccountManager, HelpContact> = {
  porter: {
    id: 'porter',
    name: 'Porter',
    email: 'porter@getfurnace.io',
    scheduleUrl: 'https://calendar.app.google/beJwbyBJgxrdiwGg8',
  },
  kyle: {
    id: 'kyle',
    name: 'Kyle',
    email: 'kyle@getfurnace.io',
    scheduleUrl:
      'https://calendar.google.com/calendar/u/0/appointments/schedules/AcZssZ2liyx27jVeg7DV-3hIjzrKVpVrVYxHwhzf8vzctZgsFBrcIw8_5rWdSGji1-tSJT1wKbW9unxM',
  },
};

export const HELP_EMAIL = HELP_CONTACTS.porter.email;
export const HELP_EMAIL_URL = `mailto:${HELP_EMAIL}`;
export const HELP_SCHEDULE_URL = HELP_CONTACTS.porter.scheduleUrl;

export function resolveHelpAccountManager(
  value: string | null | undefined,
): HelpAccountManager {
  return value === 'kyle' ? 'kyle' : 'porter';
}

export function resolveHelpRecipient(
  topic: HelpTopic,
  accountManager: string | null | undefined,
): HelpContact {
  if (topic === 'strategy') {
    return HELP_CONTACTS[resolveHelpAccountManager(accountManager)];
  }
  return HELP_CONTACTS.porter;
}

export function helpTopicLabel(topic: HelpTopic): string {
  return topic === 'technical' ? 'Technical support' : 'Strategy/check-in';
}

export function buildHelpMailto({
  recipientEmail,
  topic,
  notes,
  accountName,
  userName,
  userEmail,
}: {
  recipientEmail: string;
  topic: HelpTopic;
  notes: string;
  accountName?: string | null;
  userName?: string | null;
  userEmail?: string | null;
}): { url: string; subject: string; body: string } {
  const topicLabel = helpTopicLabel(topic);
  const trimmedAccount = accountName?.trim() || '';
  const subject = trimmedAccount
    ? `Furnace help — ${topicLabel} — ${trimmedAccount}`
    : `Furnace help — ${topicLabel}`;
  const body = [
    `Topic: ${topicLabel}`,
    `Account: ${trimmedAccount || 'Unknown'}`,
    `From: ${userName?.trim() || 'Unknown'} <${userEmail?.trim() || 'unknown'}>`,
    '',
    notes.trim(),
  ].join('\n');

  return {
    url: `mailto:${recipientEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
    subject,
    body,
  };
}

export async function copyHelpNotesToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Clipboard is best-effort; booking still proceeds.
  }
  return false;
}
