/**
 * Pure helpers for backfilling sent email_messages.attachments with Storage paths
 * from message_jobs.message_data base64 content.
 */

export type JobAttachment = {
  filename?: string;
  contentType?: string;
  content_type?: string;
  content?: string;
  size?: number;
};

export type MessageAttachment = {
  filename?: string;
  contentType?: string;
  content_type?: string;
  size?: number;
  storagePath?: string;
  part?: string;
  imapUid?: number;
};

export function matchJobAttachmentByFilename(
  jobAttachments: JobAttachment[],
  filename: string
): JobAttachment | null {
  const target = filename.toLowerCase();
  return (
    jobAttachments.find((a) => (a.filename ?? '').toLowerCase() === target) ??
    null
  );
}

export function patchMessageAttachmentsWithStoragePaths(
  messageAttachments: MessageAttachment[],
  jobAttachments: JobAttachment[],
  pathForFilename: (filename: string, index: number) => string | null
): { next: MessageAttachment[]; changed: boolean } {
  let changed = false;
  const next = messageAttachments.map((att, index) => {
    if (att.storagePath) return att;
    const filename = att.filename ?? 'attachment';
    const jobAtt = matchJobAttachmentByFilename(jobAttachments, filename);
    if (!jobAtt?.content) return att;
    const storagePath = pathForFilename(filename, index);
    if (!storagePath) return att;
    changed = true;
    return {
      ...att,
      filename,
      contentType: att.contentType ?? att.content_type ?? jobAtt.contentType ?? jobAtt.content_type ?? 'application/octet-stream',
      size: att.size ?? jobAtt.size ?? Buffer.from(jobAtt.content, 'base64').length,
      storagePath,
    };
  });
  return { next, changed };
}

export function stripJobAttachmentContent(jobAttachments: JobAttachment[]): JobAttachment[] {
  return jobAttachments.map((a) => {
    const { content: _c, ...rest } = a;
    return rest;
  });
}

export function planDryRunWrites(opts: {
  wouldUpload: boolean;
  wouldPatchMessage: boolean;
  wouldStripJob: boolean;
}): { writes: number } {
  // Dry-run writes nothing; helper exists for tests and logging clarity.
  void opts;
  return { writes: 0 };
}
