type MailboxLike = Record<string, unknown>;

const STRIPPED_MAILBOX_FIELDS = new Set([
  'smtp_password',
  'imap_password',
]);

export function toPublicMailbox<T extends MailboxLike>(mailbox: T): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(mailbox).filter(([key]) => !STRIPPED_MAILBOX_FIELDS.has(key))
  );
}
