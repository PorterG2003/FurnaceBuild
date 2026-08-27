/** Columns needed to attach a reply to a sent job without scanning nested `*`. */
export const SENT_JOB_REPLY_SELECT =
  'id, account_id, enrollment_id, campaign_id, lead_id, mailbox_id, node_id, message_type, status, sent_at, created_at, provider_message_id, submitted_message_id, message_data, campaigns(name), leads(email, name, first_name, last_name), mailboxes(account_id, email_address)' as const;

export const FIND_SENT_JOBS_BY_MESSAGE_IDS_RPC = 'find_sent_jobs_by_message_ids';
