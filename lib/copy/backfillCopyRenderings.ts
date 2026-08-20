export type CopyRenderingBackfillClass =
  | 'eligible'
  | 'already_stamped'
  | 'unmapped'
  | 'unparsed'
  | 'inbox';

export function isInboxMessageType(messageType: string | null | undefined): boolean {
  return messageType === 'inbox_reply' || messageType === 'inbox_forward';
}

export function classifyCopyRenderingBackfillJob(job: {
  messageType?: string | null;
  mappedContentId?: string | null;
  parseStatus?: string | null;
  occurrenceCount?: number;
  copyRenderingId?: string | null;
}): CopyRenderingBackfillClass {
  if (isInboxMessageType(job.messageType)) return 'inbox';
  if (job.copyRenderingId) return 'already_stamped';
  if (!job.mappedContentId) return 'unmapped';
  const parsed =
    job.parseStatus === 'done' && Number(job.occurrenceCount ?? 0) > 0;
  if (!parsed) return 'unparsed';
  return 'eligible';
}
