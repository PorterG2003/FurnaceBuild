export type DbAnomalyBucket =
  | 'healthy_sent'
  | 'sent_missing_provider_id'
  | 'sent_missing_sent_at'
  | 'failed_uncertain_send_state'
  | 'stale_sending'
  | 'stale_reserved'
  | 'other_non_sent';

export type ImapMatchBucket =
  | 'db_sent_and_imap_confirmed'
  | 'db_sent_missing_imap_match'
  | 'db_failed_uncertain_but_imap_found'
  | 'skipped_not_verifiable';

export type ImapMatchMethod = 'x-message-id' | 'provider_message_id' | 'heuristic' | null;

export type CampaignJobSnapshot = {
  id: string;
  status: string;
  status_reason: string | null;
  mailbox_id: string;
  enrollment_id: string;
  lead_id: string;
  provider_message_id: string | null;
  sent_at: string | null;
  sending_started_at: string | null;
  created_at: string;
  message_data: Record<string, unknown> | null;
};

export function normalizeMessageId(messageId: string | null | undefined): string | null {
  if (!messageId) return null;
  return messageId.trim().replace(/^<|>$/g, '').toLowerCase() || null;
}

export function normalizeEmail(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed || null;
}

export function extractLeadEmail(messageData: Record<string, unknown> | null | undefined): string | null {
  const leadData = (messageData?.lead_data ?? {}) as Record<string, unknown>;
  return normalizeEmail(typeof leadData.email === 'string' ? leadData.email : null);
}

export function extractCampaignSubject(messageData: Record<string, unknown> | null | undefined): string {
  const nodeConfig = (messageData?.node_config ?? {}) as Record<string, unknown>;
  return typeof nodeConfig.subject === 'string' ? nodeConfig.subject.trim() : '';
}

export function classifyDbJob(job: CampaignJobSnapshot): DbAnomalyBucket {
  if (job.status === 'sent') {
    if (!job.provider_message_id) return 'sent_missing_provider_id';
    if (!job.sent_at) return 'sent_missing_sent_at';
    return 'healthy_sent';
  }
  if (job.status === 'failed' && job.status_reason === 'uncertain_send_state') {
    return 'failed_uncertain_send_state';
  }
  if (job.status === 'sending') return 'stale_sending';
  if (job.status === 'reserved') return 'stale_reserved';
  return 'other_non_sent';
}

export function providerIdMatches(providerMessageId: string, searchId: string): boolean {
  const normProvider = normalizeMessageId(providerMessageId);
  if (!normProvider) return false;
  if (normProvider === searchId) return true;
  const lower = providerMessageId.toLowerCase();
  return lower.includes(searchId) || lower.includes(`<${searchId}>`);
}

export type SentIndexEntry = {
  uid: number;
  messageId: string | null;
  normalizedMessageId: string | null;
  xMessageId: string | null;
  subject: string;
  toEmails: string[];
  date: string;
};

export function matchJobInSentIndex(
  job: CampaignJobSnapshot,
  index: {
    byXMessageId: Map<string, SentIndexEntry>;
    byProviderMessageId: Map<string, SentIndexEntry>;
  },
): { bucket: ImapMatchBucket; matchedBy: ImapMatchMethod; entry: SentIndexEntry | null } {
  const xMatch = index.byXMessageId.get(job.id) ?? null;
  if (xMatch) {
    return {
      bucket: job.status === 'failed' ? 'db_failed_uncertain_but_imap_found' : 'db_sent_and_imap_confirmed',
      matchedBy: 'x-message-id',
      entry: xMatch,
    };
  }

  const providerNorm = normalizeMessageId(job.provider_message_id);
  if (providerNorm) {
    const providerMatch = index.byProviderMessageId.get(providerNorm) ?? null;
    if (providerMatch) {
      return {
        bucket: job.status === 'failed' ? 'db_failed_uncertain_but_imap_found' : 'db_sent_and_imap_confirmed',
        matchedBy: 'provider_message_id',
        entry: providerMatch,
      };
    }
  }

  if (job.status === 'failed' && job.status_reason === 'uncertain_send_state') {
    return { bucket: 'skipped_not_verifiable', matchedBy: null, entry: null };
  }

  if (job.status !== 'sent') {
    return { bucket: 'skipped_not_verifiable', matchedBy: null, entry: null };
  }

  return { bucket: 'db_sent_missing_imap_match', matchedBy: null, entry: null };
}

export function heuristicMatchJobInSentEntries(
  job: CampaignJobSnapshot,
  entries: SentIndexEntry[],
): SentIndexEntry | null {
  const toEmail = extractLeadEmail(job.message_data);
  const subject = extractCampaignSubject(job.message_data);
  if (!toEmail || !subject) return null;

  const anchor = job.sent_at ?? job.sending_started_at ?? job.created_at;
  const anchorDate = new Date(anchor);
  const windowStart = new Date(anchorDate.getTime() - 2 * 60 * 1000);
  const windowEnd = new Date(anchorDate.getTime() + 30 * 60 * 1000);
  const normalizedSubject = subject.toLowerCase().replace(/^re:\s*/i, '');

  for (const entry of entries) {
    const entryDate = new Date(entry.date);
    if (entryDate < windowStart || entryDate > windowEnd) continue;
    if (!entry.toEmails.includes(toEmail)) continue;
    const entrySubject = entry.subject.toLowerCase();
    if (
      entrySubject === subject.toLowerCase() ||
      entrySubject.includes(normalizedSubject)
    ) {
      return entry;
    }
  }

  return null;
}

export type RecommendationLevel = 'low_risk' | 'investigate_mailboxes' | 'strong_send_mismatch';

export function buildRecommendation(input: {
  sentCampaignJobs: number;
  dbSuspectCount: number;
  imapMissingMatchCount: number;
  uncertainFailedCount: number;
  uncertainButFoundInImapCount: number;
}): { level: RecommendationLevel; message: string } {
  const { sentCampaignJobs, dbSuspectCount, imapMissingMatchCount, uncertainFailedCount, uncertainButFoundInImapCount } =
    input;

  const imapSuspectRate = sentCampaignJobs > 0 ? imapMissingMatchCount / sentCampaignJobs : 0;
  const dbSuspectRate = sentCampaignJobs > 0 ? dbSuspectCount / sentCampaignJobs : 0;

  if (imapMissingMatchCount >= 50 || imapSuspectRate >= 0.05) {
    return {
      level: 'strong_send_mismatch',
      message:
        'Strong evidence of send-state mismatch. Investigate IMAP Sent retention and send-worker finalize path before attributing low performance to offer/list quality.',
    };
  }

  if (
    dbSuspectCount >= 20 ||
    imapMissingMatchCount >= 10 ||
    dbSuspectRate >= 0.01 ||
    uncertainButFoundInImapCount >= 5
  ) {
    return {
      level: 'investigate_mailboxes',
      message:
        'Moderate send-side anomalies detected. Review suspect mailboxes and uncertain_send_state jobs; unlikely to fully explain a 3x-4x performance gap alone.',
    };
  }

  return {
    level: 'low_risk',
    message:
      `Low false-send risk (${dbSuspectCount} DB suspect rows, ${imapMissingMatchCount} IMAP misses, ${uncertainFailedCount} uncertain failures). Performance gap is likely elsewhere.`,
  };
}

export function summarizeDbBuckets(counts: Record<DbAnomalyBucket, number>): {
  sentCampaignJobs: number;
  healthySent: number;
  dbSuspectCount: number;
} {
  const sentCampaignJobs =
    counts.healthy_sent +
    counts.sent_missing_provider_id +
    counts.sent_missing_sent_at;
  const dbSuspectCount =
    counts.sent_missing_provider_id +
    counts.sent_missing_sent_at +
    counts.failed_uncertain_send_state +
    counts.stale_sending +
    counts.stale_reserved;

  return {
    sentCampaignJobs,
    healthySent: counts.healthy_sent,
    dbSuspectCount,
  };
}

export type MailboxScanSummaryLike = {
  mailbox_id: string;
  scanned_sent_messages: number;
  confirmed: number;
  errors: string[];
};

export function isTimeoutOnlyMailboxResult(row: MailboxScanSummaryLike): boolean {
  return (
    row.scanned_sent_messages === 0 &&
    row.confirmed === 0 &&
    row.errors.some((error) => error.toLowerCase().includes('timed out'))
  );
}

export function pickPreferredMailboxResult<T extends MailboxScanSummaryLike>(
  a: T,
  b: T,
): T {
  const aTimeout = isTimeoutOnlyMailboxResult(a);
  const bTimeout = isTimeoutOnlyMailboxResult(b);
  if (aTimeout && !bTimeout) return b;
  if (bTimeout && !aTimeout) return a;
  if (a.confirmed !== b.confirmed) return a.confirmed > b.confirmed ? a : b;
  if (a.scanned_sent_messages !== b.scanned_sent_messages) {
    return a.scanned_sent_messages > b.scanned_sent_messages ? a : b;
  }
  return a;
}

export function dedupeMailboxIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    deduped.push(id);
  }
  return deduped;
}

export function dedupeMailboxResults<T extends MailboxScanSummaryLike & { mailbox_id: string }>(
  results: T[],
): T[] {
  const byId = new Map<string, T>();
  for (const row of results) {
    const existing = byId.get(row.mailbox_id);
    byId.set(row.mailbox_id, existing ? pickPreferredMailboxResult(row, existing) : row);
  }
  return [...byId.values()];
}

/** Rebuild completed IDs from scan results; timeout-only rows are not considered complete. */
export function completedMailboxIdsFromResults<T extends MailboxScanSummaryLike & { mailbox_id: string }>(
  results: T[],
): string[] {
  return dedupeMailboxResults(results)
    .filter((row) => !isTimeoutOnlyMailboxResult(row))
    .map((row) => row.mailbox_id);
}
