import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SMARTLEAD_BASE, smartleadRequest } from '../lib/smartlead/api.js';
import {
  type SmartleadCampaignStats,
  fetchSmartleadCampaignEmailAccounts,
  fetchSmartleadCampaignStatsByDay,
  fetchSmartleadLeads,
  finalizeImportedCampaignStats,
} from '../lib/smartlead/migration.js';
import { fetchSecretFromParameterStore, loadSelfRecoveryEnv, resolveSecretParamPathForTarget, resolveSelfRecoveryTargetEnv, resolveSupabaseUrlForTarget } from './self-recovery-env.js';
import { openImapInbox } from '@furnace/mailbox-lib';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

loadSelfRecoveryEnv();

type Mode = 'spike' | 'audit' | 'import' | 'materialize-export';

type Args = {
  mode: Mode;
  campaignId: string | null;
  since: Date;
  until: Date | null;
  copyPath: string | null;
  inputPath: string | null;
  outputPath: string | null;
  exportOutputPath: string | null;
  checkpointPath: string | null;
  resumeFromPath: string | null;
  mailboxLimit: number | null;
  mailboxStart: number | null;
  mailboxCount: number | null;
  mailboxEmails: string[] | null;
  spikeMessages: number;
  concurrency: number;
  minConfidence: number;
  smartleadApiKey: string | null;
  allAccountMailboxes: boolean;
};

type CampaignRow = {
  id: string;
  account_id: string;
  name: string;
  smartlead_campaign_id: number | null;
  source: string | null;
};

type MailboxRow = {
  id: string;
  account_id: string;
  email_address: string;
  display_name: string | null;
  imap_host: string;
  imap_port: number;
  imap_username: string;
  imap_password: string;
  imap_use_ssl: boolean;
  status: 'connected' | 'disconnected' | 'error' | null;
  deleted_at?: string | null;
};

type LeadRow = {
  id: string;
  email: string | null;
  smartlead_lead_id: number | null;
};

type EnrollmentRow = {
  id: string;
  lead_id: string;
};

type LeadRecord = {
  leadId: string | null;
  enrollmentId: string | null;
  smartleadLeadId: number | null;
  email: string;
  overlapCount: number;
  hasFurnaceMapping: boolean;
};

type RecipientDiagnostics = {
  source: 'smartlead_campaign_leads' | 'furnace_campaign_leads';
  smartleadLeadCount: number;
  furnaceMappedCount: number;
  unmappedSmartleadCount: number;
  warnings: string[];
};

type SenderDiagnostics = {
  source: 'smartlead_campaign_email_accounts' | 'furnace_account_mailboxes';
  smartleadAssignedCount: number;
  furnaceMailboxCount: number;
  intersectionCount: number;
  smartleadOnlyEmails: string[];
  furnaceOnlyEmails: string[];
  selectedForScan: number;
  /** Operator-reported count of mailboxes Smartlead assigned per campaign before reconnect. */
  knownHistoricalAssignmentCount: number | null;
  /** Minimum scan batch to guarantee at least one historically assigned mailbox (pool - assigned + 1). */
  minBatchForCoverageGuarantee: number | null;
  meetsCoverageGuarantee: boolean;
  warnings: string[];
};

type CampaignSentExpectationDiagnostics = {
  sinceDate: string;
  /** Operator expectation for both Foot Traffic campaigns combined. */
  operatorExpectedCombinedSent: number;
  smartleadReportedSentThisCampaign: number | null;
  smartleadReportedSentCompanion: number | null;
  smartleadReportedSentCombined: number | null;
  companionCampaignName: string | null;
  /** Expected tagged Sent for the campaign under audit (this campaign's Smartlead sent, not the combined 6k). */
  expectedTaggedSent: number;
  imapTaggedSent: number;
  imapToLead: number;
  projectedTaggedSent: number | null;
  recoveryRatio: number | null;
  projectedRecoveryRatio: number | null;
  meetsOperatorExpectation: boolean;
  warnings: string[];
};

type FurnaceLeadJoinRow = {
  leadId: string;
  enrollmentId: string | null;
  smartleadLeadId: number | null;
  email: string;
};

type CopyStep = {
  label: string;
  subject: string;
  bodyFingerprints?: string[];
};

type CopyConfig = {
  campaignId: string;
  name?: string;
  steps: CopyStep[];
  source: 'manual_json' | 'smartlead_api';
};

type SentMessageRecord = {
  mailboxId: string;
  mailboxEmail: string;
  sentFolderPath: string;
  uid: number;
  messageId: string | null;
  rawMessageId: string | null;
  inReplyTo: string | null;
  messageReferences: string | null;
  sentAt: string;
  subject: string;
  normalizedSubject: string;
  bodyText: string | null;
  bodyHtml: string | null;
  bodySnippet: string;
  leadEmail: string;
  leadId: string;
  enrollmentId: string | null;
  smartleadLeadId: number | null;
  copyMatched: boolean;
  bodyMatched: boolean;
  stepLabel: string | null;
  ambiguousLeadEmail: boolean;
};

type CandidateMatchType = 'thread_anchor' | 'subject_lead' | 'review';

type CandidateRow = {
  confidence: number;
  matchType: CandidateMatchType;
  reason: string;
  leadEmail: string;
  leadId: string;
  enrollmentId: string | null;
  smartleadLeadId: number | null;
  mailboxId: string;
  mailboxEmail: string;
  sentFolderPath: string | null;
  receivedAt: string;
  subject: string;
  normalizedSubject: string;
  messageId: string | null;
  inReplyTo: string | null;
  references: string | null;
  sentMessageId: string | null;
  sentAt: string | null;
  stepLabel: string | null;
  ambiguousLeadEmail: boolean;
  bodyFingerprintMatched: boolean;
  receivedMessage?: RecoveryMessageExport | null;
  sentMessages?: RecoveryMessageExport[];
};

type RecoveryMessageExport = {
  uid: number;
  folder: string;
  direction: 'sent' | 'received';
  messageId: string | null;
  rawMessageId: string | null;
  inReplyTo: string | null;
  references: string | null;
  subject: string;
  from: string | null;
  to: string[];
  date: string;
  bodyText: string | null;
  bodyHtml: string | null;
};

type ImportReadiness = 'ready' | 'needs_lead_mapping' | 'needs_review';

type RecoveryThreadExport = {
  bucket: 'candidate' | 'review';
  confidence: number;
  matchType: CandidateMatchType;
  reason: string;
  leadEmail: string;
  leadId: string | null;
  enrollmentId: string | null;
  smartleadLeadId: number | null;
  mailboxId: string;
  mailboxEmail: string;
  importReadiness: ImportReadiness;
  receivedMessage: RecoveryMessageExport | null;
  sentMessages: RecoveryMessageExport[];
  threadDraft: {
    subject: string;
    participants: string[];
    lastMessageAt: string;
    messageCount: number;
    hasReply: true;
  };
};

type RecoveryExportPackage = {
  version: 1;
  generatedAt: string;
  campaign: {
    furnaceId: string;
    smartleadId: number | null;
    name: string;
    accountId: string;
    since: string;
    until: string | null;
  };
  auditSummary: {
    scannedMailboxes: number;
    sentIndexSize: number;
    sentRecoveryRatio: number | null;
    candidateCount: number;
    reviewCount: number;
    gateStatus: string;
  };
  threads: RecoveryThreadExport[];
};

type CopyDiagnosticStep = {
  label: string;
  normalizedSubject: string;
  bodyFingerprintSample: string | null;
};

type SentDiagnosticSample = {
  uid: number;
  leadEmail: string | null;
  overlapCount: number | null;
  subject: string;
  normalizedSubject: string;
  bodySnippet: string;
  to: string[];
  messageId: string | null;
  rawMessageId: string | null;
  subjectMatched: boolean;
  bodyMatched: boolean;
  stepLabel: string | null;
  reason: string;
};

type InboxDiagnosticSample = {
  uid: number;
  leadEmail: string;
  overlapCount: number;
  subject: string;
  normalizedSubject: string;
  messageId: string | null;
  inReplyTo: string | null;
  references: string | null;
  searchIds: string[];
  matchedSearchIds: string[];
  wrongLeadSearchIds: string[];
  subjectMatched: boolean;
  bodyMatched: boolean;
  matchedStepLabel: string | null;
  reason: string;
};

type MailboxDiagnostics = {
  mailboxEmail: string;
  folderPath: string | null;
  sent: {
    scannedSent: number;
    toLead: number;
    noLeadMatch: number;
    copySubjectMatch: number;
    copyBodyMatch: number;
    tagged: number;
    untaggedOverlapNoCopy: number;
    uniqueLeadTaggedWithoutCopy: number;
  };
  inbox: {
    scannedInbox: number;
    leadMatches: number;
    noSearchIds: number;
    searchIdsNoSentHit: number;
    searchIdsHitWrongLead: number;
    anchored: number;
    leadOnlySubjectMatch: number;
    leadOnlyBodyMatch: number;
    review: number;
    dropped: number;
  };
  skippedSentSamples: SentDiagnosticSample[];
  replyMissSamples: InboxDiagnosticSample[];
};

type AuditDiagnostics = {
  copy: {
    source: string | null;
    stepCount: number;
    sampleSteps: CopyDiagnosticStep[];
    warnings: string[];
  };
  recipients: RecipientDiagnostics;
  senders: SenderDiagnostics;
  campaignSentExpectation: CampaignSentExpectationDiagnostics;
  comparisonNotes: string[];
  totals: {
    sent: MailboxDiagnostics['sent'];
    inbox: MailboxDiagnostics['inbox'];
  };
  mailboxes: MailboxDiagnostics[];
};

type AuditOutput = {
  generatedAt: string;
  campaignId: string;
  campaignName: string;
  accountId: string;
  copySource: string | null;
  scannedMailboxes: number;
  sentIndexSize: number;
  sentSubjectSummary: Array<{
    normalizedSubject: string;
    sampleSubject: string;
    count: number;
  }>;
  sentFolderUsage: Array<{
    mailboxEmail: string;
    folderPath: string | null;
    outboundTagged: number;
    scannedSent: number;
    scannedInbox: number;
    errors: string[];
  }>;
  candidates: CandidateRow[];
  review: CandidateRow[];
  dropped: number;
  errors: string[];
  diagnostics: AuditDiagnostics;
};

type ImportSummary = {
  generatedAt: string;
  campaignId: string;
  createdThreads: number;
  skippedExistingThreads: number;
  skippedExistingMessages: number;
  insertedMessages: number;
  importedLeadEmails: string[];
  skipped: Array<{ leadEmail: string; reason: string }>;
};

type AuditCheckpoint = {
  kind: 'audit';
  version: 1;
  generatedAt: string;
  updatedAt: string;
  campaignId: string;
  selectedMailboxIds: string[];
  args: {
    since: string;
    until: string | null;
    concurrency: number;
    copySource: string | null;
  };
  completedMailboxIds: string[];
  sentIndexSize: number;
  sentSubjectSummary: Array<{
    normalizedSubject: string;
    sampleSubject: string;
    count: number;
  }>;
  sentFolderUsage: AuditOutput['sentFolderUsage'];
  candidates: CandidateRow[];
  review: CandidateRow[];
  dropped: number;
  errors: string[];
  diagnostics?: AuditDiagnostics;
};

type ImportCheckpoint = {
  kind: 'import';
  version: 1;
  generatedAt: string;
  updatedAt: string;
  campaignId: string;
  inputPath: string;
  minConfidence: number;
  processedCandidateKeys: string[];
  summary: ImportSummary;
};

type SpikeResult = {
  mailboxEmail: string;
  sentFolderPath: string | null;
  discoveredFolders: string[];
  sampledSentMessages: number;
  sentMessagesScanned: number;
  sampleAnyMessageIds: string[];
  sampleAnySubjects: string[];
  sampleMessageIds: string[];
  sampleSubjects: string[];
  errors: string[];
};

function parseArgs(argv: string[]): Args {
  let mode: Mode = process.env.RECOVERY_MODE === 'import'
    ? 'import'
    : process.env.RECOVERY_MODE === 'spike'
      ? 'spike'
      : 'audit';
  let campaignId = process.env.CAMPAIGN_ID?.trim() || null;
  let sinceStr = process.env.RECOVERY_SINCE?.trim() || '2026-05-01';
  let untilStr = process.env.RECOVERY_UNTIL?.trim() || null;
  let copyPath = process.env.RECOVERY_COPY?.trim() || null;
  let inputPath = process.env.RECOVERY_INPUT?.trim() || null;
  let outputPath = process.env.RECOVERY_OUTPUT?.trim() || null;
  let exportOutputPath = process.env.RECOVERY_EXPORT_OUTPUT?.trim() || null;
  let checkpointPath = process.env.RECOVERY_CHECKPOINT?.trim() || null;
  let resumeFromPath = process.env.RECOVERY_RESUME_FROM?.trim() || null;
  let mailboxLimit = process.env.RECOVERY_MAILBOX_LIMIT ? Number(process.env.RECOVERY_MAILBOX_LIMIT) : null;
  let mailboxStart = process.env.RECOVERY_MAILBOX_START ? Number(process.env.RECOVERY_MAILBOX_START) : null;
  let mailboxCount = process.env.RECOVERY_MAILBOX_COUNT ? Number(process.env.RECOVERY_MAILBOX_COUNT) : null;
  let mailboxEmails = process.env.RECOVERY_MAILBOXES?.trim()
    ? process.env.RECOVERY_MAILBOXES.split(',').map((value) => value.trim()).filter(Boolean)
    : null;
  let spikeMessages = Number(process.env.RECOVERY_SPIKE_MESSAGES ?? '10');
  let concurrency = Number(process.env.RECOVERY_CONCURRENCY ?? '5');
  let minConfidence = Number(process.env.RECOVERY_MIN_CONFIDENCE ?? '80');
  let smartleadApiKey = process.env.SMARTLEAD_API_KEY?.trim() || null;
  let allAccountMailboxes = process.env.RECOVERY_ALL_ACCOUNT_MAILBOXES === 'true';

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--mode' && argv[i + 1]) {
      const value = argv[++i]!;
      if (value === 'spike' || value === 'audit' || value === 'import') {
        mode = value;
      }
    } else if (arg === '--spike') {
      mode = 'spike';
    } else if (arg === '--campaign-id' && argv[i + 1]) {
      campaignId = argv[++i]!;
    } else if (arg === '--since' && argv[i + 1]) {
      sinceStr = argv[++i]!;
    } else if (arg === '--until' && argv[i + 1]) {
      untilStr = argv[++i]!;
    } else if (arg === '--copy' && argv[i + 1]) {
      copyPath = argv[++i]!;
    } else if (arg === '--input' && argv[i + 1]) {
      inputPath = argv[++i]!;
      if (mode !== 'materialize-export') {
        mode = 'import';
      }
    } else if (arg === '--output' && argv[i + 1]) {
      outputPath = argv[++i]!;
    } else if (arg === '--export-output' && argv[i + 1]) {
      exportOutputPath = argv[++i]!;
    } else if (arg === '--materialize-export') {
      mode = 'materialize-export';
    } else if (arg === '--checkpoint' && argv[i + 1]) {
      checkpointPath = argv[++i]!;
    } else if (arg === '--resume-from' && argv[i + 1]) {
      resumeFromPath = argv[++i]!;
    } else if ((arg === '--limit-mailboxes' || arg === '--mailbox-limit') && argv[i + 1]) {
      mailboxLimit = Number(argv[++i]);
    } else if (arg === '--mailbox-start' && argv[i + 1]) {
      mailboxStart = Number(argv[++i]);
    } else if (arg === '--mailbox-count' && argv[i + 1]) {
      mailboxCount = Number(argv[++i]);
    } else if (arg === '--mailboxes' && argv[i + 1]) {
      mailboxEmails = argv[++i]!.split(',').map((value) => value.trim()).filter(Boolean);
    } else if (arg === '--spike-messages' && argv[i + 1]) {
      spikeMessages = Number(argv[++i]);
    } else if (arg === '--concurrency' && argv[i + 1]) {
      concurrency = Number(argv[++i]);
    } else if (arg === '--min-confidence' && argv[i + 1]) {
      minConfidence = Number(argv[++i]);
    } else if (arg === '--smartlead-api-key' && argv[i + 1]) {
      smartleadApiKey = argv[++i]!;
    } else if (arg === '--all-account-mailboxes') {
      allAccountMailboxes = true;
    }
  }

  return {
    mode,
    campaignId,
    since: new Date(`${sinceStr}T00:00:00.000Z`),
    until: untilStr ? new Date(`${untilStr}T23:59:59.999Z`) : null,
    copyPath,
    inputPath,
    outputPath,
    exportOutputPath,
    checkpointPath,
    resumeFromPath,
    mailboxLimit: mailboxLimit != null && Number.isFinite(mailboxLimit) ? mailboxLimit : null,
    mailboxStart: mailboxStart != null && Number.isFinite(mailboxStart) && mailboxStart >= 0 ? mailboxStart : null,
    mailboxCount: mailboxCount != null && Number.isFinite(mailboxCount) && mailboxCount > 0 ? mailboxCount : null,
    mailboxEmails: mailboxEmails && mailboxEmails.length > 0 ? mailboxEmails : null,
    spikeMessages: Number.isFinite(spikeMessages) && spikeMessages > 0 ? spikeMessages : 10,
    concurrency: Number.isFinite(concurrency) && concurrency > 0 ? concurrency : 5,
    minConfidence: Number.isFinite(minConfidence) ? minConfidence : 80,
    smartleadApiKey,
    allAccountMailboxes,
  };
}

function normalizeEmail(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.trim().toLowerCase() || null;
}

function normalizeMessageId(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.trim().replace(/^<|>$/g, '').toLowerCase() || null;
}

function normalizeReferences(value: string | null | undefined): string | null {
  if (!value) return null;
  const parts = value
    .split(/\s+/)
    .map((part) => normalizeMessageId(part))
    .filter((part): part is string => !!part);
  return parts.length > 0 ? parts.join(' ') : null;
}

function extractSearchIds(inReplyTo: string | null, references: string | null): string[] {
  const ids: string[] = [];
  const parent = normalizeMessageId(inReplyTo);
  if (parent) ids.push(parent);
  if (references) {
    for (const part of references.split(/\s+/)) {
      const norm = normalizeMessageId(part);
      if (norm && !ids.includes(norm)) ids.push(norm);
    }
  }
  return ids;
}

function normalizeSubjectCore(subject: string | null | undefined): string {
  if (!subject) return '';
  let value = subject.trim().toLowerCase();
  while (true) {
    const next = value.replace(/^(re|fwd?|aw)\s*:\s*/i, '').trim();
    if (next === value) break;
    value = next;
  }
  return value.replace(/\s+/g, ' ').trim();
}

function textFromHtml(html: string | null | undefined): string {
  if (!html) return '';
  return html.replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeBodyText(text: string | null | undefined): string {
  if (!text) return '';
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function bodySnippet(text: string | null, html: string | null, maxLength = 180): string {
  const source = (text?.trim() || textFromHtml(html)).trim();
  return source.length > maxLength ? source.slice(0, maxLength) : source;
}

const MAX_DIAGNOSTIC_SAMPLES_PER_MAILBOX = 5;
const MAX_COPY_DIAGNOSTIC_STEPS = 12;

function pushLimited<T>(items: T[], value: T, limit: number): void {
  if (items.length < limit) items.push(value);
}

function createMailboxDiagnostics(mailboxEmail: string): MailboxDiagnostics {
  return {
    mailboxEmail,
    folderPath: null,
    sent: {
      scannedSent: 0,
      toLead: 0,
      noLeadMatch: 0,
      copySubjectMatch: 0,
      copyBodyMatch: 0,
      tagged: 0,
      untaggedOverlapNoCopy: 0,
      uniqueLeadTaggedWithoutCopy: 0,
    },
    inbox: {
      scannedInbox: 0,
      leadMatches: 0,
      noSearchIds: 0,
      searchIdsNoSentHit: 0,
      searchIdsHitWrongLead: 0,
      anchored: 0,
      leadOnlySubjectMatch: 0,
      leadOnlyBodyMatch: 0,
      review: 0,
      dropped: 0,
    },
    skippedSentSamples: [],
    replyMissSamples: [],
  };
}

function cloneMailboxDiagnostics(mailbox: MailboxDiagnostics): MailboxDiagnostics {
  return {
    mailboxEmail: mailbox.mailboxEmail,
    folderPath: mailbox.folderPath,
    sent: { ...mailbox.sent },
    inbox: { ...mailbox.inbox },
    skippedSentSamples: [...mailbox.skippedSentSamples],
    replyMissSamples: [...mailbox.replyMissSamples],
  };
}

function summarizeCopyForDiagnostics(copy: CopyConfig | null, warnings: string[]): AuditDiagnostics['copy'] {
  return {
    source: copy?.source ?? null,
    stepCount: copy?.steps.length ?? 0,
    sampleSteps: (copy?.steps ?? []).slice(0, MAX_COPY_DIAGNOSTIC_STEPS).map((step) => ({
      label: step.label,
      normalizedSubject: normalizeSubjectCore(step.subject),
      bodyFingerprintSample: step.bodyFingerprints?.[0] ? normalizeBodyText(step.bodyFingerprints[0]).slice(0, 140) : null,
    })),
    warnings: [...warnings],
  };
}

function getLiveComparisonNotes(): string[] {
  return [
    'Recipient matching prefers Smartlead campaign leads when SMARTLEAD_API_KEY is available.',
    'When Smartlead campaign email-accounts is empty (mailboxes reconnected/unassigned), scan the Furnace pool directly.',
    'Foot Traffic campaigns historically used 100 of ~150 shared mailboxes; scan at least 51 to guarantee one assigned sender in the batch.',
    'Audit and import scan every Sent/INBOX message in the --since/--until date window; there is no per-mailbox message cap.',
    'Recovery only anchors replies to tagged Sent rows on the same mailbox.',
    'Live inbox threading first matches normalized Message-IDs against stored outbound provider_message_id values.',
    'Overlapping lead emails in recovery require Smartlead subject or body copy proof before the Sent row is tagged.',
  ];
}

function createEmptySenderDiagnostics(): SenderDiagnostics {
  return {
    source: 'furnace_account_mailboxes',
    smartleadAssignedCount: 0,
    furnaceMailboxCount: 0,
    intersectionCount: 0,
    smartleadOnlyEmails: [],
    furnaceOnlyEmails: [],
    selectedForScan: 0,
    knownHistoricalAssignmentCount: null,
    minBatchForCoverageGuarantee: null,
    meetsCoverageGuarantee: false,
    warnings: [],
  };
}

function leadsSameIdentity(
  a: Pick<LeadRecord, 'leadId' | 'smartleadLeadId' | 'email'> | Pick<SentMessageRecord, 'leadId' | 'smartleadLeadId' | 'leadEmail'>,
  b: Pick<LeadRecord, 'leadId' | 'smartleadLeadId' | 'email'> | Pick<SentMessageRecord, 'leadId' | 'smartleadLeadId' | 'leadEmail'>,
): boolean {
  const emailA = 'email' in a ? a.email : a.leadEmail;
  const emailB = 'email' in b ? b.email : b.leadEmail;
  if (a.leadId && b.leadId && a.leadId === b.leadId) return true;
  if (a.smartleadLeadId != null && b.smartleadLeadId != null && a.smartleadLeadId === b.smartleadLeadId) return true;
  return emailA === emailB;
}

function isImportableLeadId(leadId: string | null | undefined): boolean {
  if (!leadId) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(leadId);
}

type ParsedImapMessage = Awaited<ReturnType<typeof parseImapMessage>>;

function parsedToExportMessage(
  parsed: ParsedImapMessage,
  folder: string,
  direction: 'sent' | 'received',
): RecoveryMessageExport {
  return {
    uid: parsed.uid,
    folder,
    direction,
    messageId: parsed.messageId,
    rawMessageId: parsed.rawMessageId,
    inReplyTo: parsed.inReplyTo,
    references: parsed.messageReferences,
    subject: parsed.subject,
    from: parsed.from,
    to: parsed.to,
    date: parsed.date.toISOString(),
    bodyText: parsed.bodyText,
    bodyHtml: parsed.bodyHtml,
  };
}

function sentRecordToExportMessage(sent: SentMessageRecord): RecoveryMessageExport {
  return {
    uid: sent.uid,
    folder: sent.sentFolderPath,
    direction: 'sent',
    messageId: sent.messageId,
    rawMessageId: sent.rawMessageId,
    inReplyTo: sent.inReplyTo,
    references: sent.messageReferences,
    subject: sent.subject,
    from: sent.mailboxEmail,
    to: [sent.leadEmail],
    date: sent.sentAt,
    bodyText: sent.bodyText,
    bodyHtml: sent.bodyHtml,
  };
}

function selectSentMessagesForExport(
  taggedSentMessages: SentMessageRecord[],
  leadEmail: string,
  receivedAt: string,
): RecoveryMessageExport[] {
  const receivedTime = new Date(receivedAt).getTime();
  return taggedSentMessages
    .filter(
      (sent) =>
        sent.leadEmail === leadEmail &&
        new Date(sent.sentAt).getTime() <= receivedTime,
    )
    .sort((a, b) => a.sentAt.localeCompare(b.sentAt))
    .map((sent) => sentRecordToExportMessage(sent));
}

function resolveImportReadiness(row: CandidateRow, bucket: 'candidate' | 'review'): ImportReadiness {
  if (bucket === 'review' || row.matchType === 'review') return 'needs_review';
  if (!isImportableLeadId(row.leadId)) return 'needs_lead_mapping';
  if (row.matchType === 'thread_anchor' || row.matchType === 'subject_lead') return 'ready';
  return 'needs_review';
}

function buildThreadDraft(
  row: CandidateRow,
  receivedMessage: RecoveryMessageExport | null,
  sentMessages: RecoveryMessageExport[],
): RecoveryThreadExport['threadDraft'] {
  const participants = Array.from(
    new Set(
      [
        row.mailboxEmail,
        row.leadEmail,
        ...sentMessages.flatMap((message) => message.to),
        receivedMessage?.from ?? '',
      ].filter(Boolean),
    ),
  );
  const subject = sentMessages[0]?.subject ?? row.subject;
  const lastMessageAt = receivedMessage?.date ?? row.receivedAt;
  return {
    subject,
    participants,
    lastMessageAt,
    messageCount: sentMessages.length + (receivedMessage ? 1 : 0),
    hasReply: true,
  };
}

function candidateToThreadExport(row: CandidateRow, bucket: 'candidate' | 'review'): RecoveryThreadExport {
  const receivedMessage = row.receivedMessage ?? null;
  const sentMessages = row.sentMessages ?? [];
  return {
    bucket,
    confidence: row.confidence,
    matchType: row.matchType,
    reason: row.reason,
    leadEmail: row.leadEmail,
    leadId: isImportableLeadId(row.leadId) ? row.leadId : null,
    enrollmentId: row.enrollmentId,
    smartleadLeadId: row.smartleadLeadId,
    mailboxId: row.mailboxId,
    mailboxEmail: row.mailboxEmail,
    importReadiness: resolveImportReadiness(row, bucket),
    receivedMessage,
    sentMessages,
    threadDraft: buildThreadDraft(row, receivedMessage, sentMessages),
  };
}

function buildRecoveryExportPackage(
  audit: AuditOutput,
  campaign: CampaignRow,
  args: Args,
  gate: { status: string },
): RecoveryExportPackage {
  const threads = [
    ...dedupeCandidates(audit.candidates).map((row) => candidateToThreadExport(row, 'candidate')),
    ...dedupeCandidates(audit.review).map((row) => candidateToThreadExport(row, 'review')),
  ].sort((a, b) => a.threadDraft.lastMessageAt.localeCompare(b.threadDraft.lastMessageAt));

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    campaign: {
      furnaceId: campaign.id,
      smartleadId: campaign.smartlead_campaign_id,
      name: campaign.name,
      accountId: campaign.account_id,
      since: args.since.toISOString(),
      until: args.until?.toISOString() ?? null,
    },
    auditSummary: {
      scannedMailboxes: audit.scannedMailboxes,
      sentIndexSize: audit.sentIndexSize,
      sentRecoveryRatio: audit.diagnostics.campaignSentExpectation.recoveryRatio,
      candidateCount: audit.candidates.length,
      reviewCount: audit.review.length,
      gateStatus: gate.status,
    },
    threads,
  };
}

function hasMessageBody(message: RecoveryMessageExport | null | undefined): boolean {
  if (!message) return false;
  return Boolean(message.bodyText?.trim() || message.bodyHtml?.trim());
}

function createEmptyAuditDiagnostics(copy: CopyConfig | null, warnings: string[]): AuditDiagnostics {
  return {
    copy: summarizeCopyForDiagnostics(copy, warnings),
    recipients: {
      source: 'furnace_campaign_leads',
      smartleadLeadCount: 0,
      furnaceMappedCount: 0,
      unmappedSmartleadCount: 0,
      warnings: [],
    },
    senders: createEmptySenderDiagnostics(),
    campaignSentExpectation: createEmptyCampaignSentExpectation('2026-05-01'),
    comparisonNotes: getLiveComparisonNotes(),
    totals: {
      sent: {
        scannedSent: 0,
        toLead: 0,
        noLeadMatch: 0,
        copySubjectMatch: 0,
        copyBodyMatch: 0,
        tagged: 0,
        untaggedOverlapNoCopy: 0,
        uniqueLeadTaggedWithoutCopy: 0,
      },
      inbox: {
        scannedInbox: 0,
        leadMatches: 0,
        noSearchIds: 0,
        searchIdsNoSentHit: 0,
        searchIdsHitWrongLead: 0,
        anchored: 0,
        leadOnlySubjectMatch: 0,
        leadOnlyBodyMatch: 0,
        review: 0,
        dropped: 0,
      },
    },
    mailboxes: [],
  };
}

function cloneAuditDiagnostics(diagnostics: AuditDiagnostics | undefined, copy: CopyConfig | null, warnings: string[]): AuditDiagnostics {
  if (!diagnostics) return createEmptyAuditDiagnostics(copy, warnings);
  return {
    copy: {
      source: diagnostics.copy.source,
      stepCount: diagnostics.copy.stepCount,
      sampleSteps: [...diagnostics.copy.sampleSteps],
      warnings: [...diagnostics.copy.warnings],
    },
    recipients: diagnostics.recipients
      ? { ...diagnostics.recipients, warnings: [...diagnostics.recipients.warnings] }
      : createEmptyAuditDiagnostics(copy, warnings).recipients,
    senders: diagnostics.senders
      ? {
          ...diagnostics.senders,
          smartleadOnlyEmails: [...diagnostics.senders.smartleadOnlyEmails],
          furnaceOnlyEmails: [...diagnostics.senders.furnaceOnlyEmails],
          warnings: [...diagnostics.senders.warnings],
        }
      : createEmptySenderDiagnostics(),
    campaignSentExpectation: diagnostics.campaignSentExpectation
      ? { ...diagnostics.campaignSentExpectation, warnings: [...diagnostics.campaignSentExpectation.warnings] }
      : createEmptyCampaignSentExpectation('2026-05-01'),
    comparisonNotes: [...diagnostics.comparisonNotes],
    totals: {
      sent: { ...diagnostics.totals.sent },
      inbox: { ...diagnostics.totals.inbox },
    },
    mailboxes: diagnostics.mailboxes.map(cloneMailboxDiagnostics),
  };
}

function parseMailboxAddress(raw: unknown): string | null {
  if (typeof raw === 'string') {
    const direct = normalizeEmail(raw);
    if (direct?.includes('@')) return direct;
    const match = raw.match(/<([^>]+)>/);
    return normalizeEmail(match?.[1] ?? null);
  }
  if (raw && typeof raw === 'object') {
    const value = raw as { address?: string };
    return normalizeEmail(value.address ?? null);
  }
  return null;
}

function collectAddressList(input: unknown): string[] {
  if (!input || typeof input !== 'object') return [];
  const maybeValue = input as { value?: unknown[] };
  if (!Array.isArray(maybeValue.value)) return [];
  const emails: string[] = [];
  for (const item of maybeValue.value) {
    const parsed = parseMailboxAddress(item);
    if (parsed && !emails.includes(parsed)) emails.push(parsed);
  }
  return emails;
}

function resolveSupabaseCredentials() {
  const targetEnv = resolveSelfRecoveryTargetEnv();
  const { url, source: urlSource } = resolveSupabaseUrlForTarget(targetEnv);
  const awsRegion =
    process.env.AWS_REGION?.trim() ||
    process.env.CDK_DEFAULT_REGION?.trim() ||
    'us-west-2';
  return { targetEnv, url, urlSource, awsRegion };
}

async function createSupabase(): Promise<{
  targetEnv: 'prod' | 'dev';
  urlSource: string;
  secretSource: string;
  supabase: SupabaseClient;
}> {
  const { targetEnv, url, urlSource, awsRegion } = resolveSupabaseCredentials();
  let key =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    null;
  const secretParamPath = resolveSecretParamPathForTarget(targetEnv);
  if (secretParamPath) {
    key = await fetchSecretFromParameterStore(secretParamPath, awsRegion);
  }
  if (!url || !key) {
    throw new Error('Missing Supabase configuration. Provide URL plus SSM prefix or SUPABASE_SERVICE_ROLE_KEY.');
  }
  return {
    targetEnv,
    urlSource,
    secretSource: secretParamPath ? `Parameter Store ${secretParamPath}` : 'environment variable',
    supabase: createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    }),
  };
}

async function fetchCampaign(supabase: SupabaseClient, campaignId: string): Promise<CampaignRow> {
  const { data, error } = await supabase
    .from('campaigns')
    .select('id, account_id, name, smartlead_campaign_id, source')
    .eq('id', campaignId)
    .single();
  if (error || !data) throw new Error(`Failed to load campaign ${campaignId}: ${error?.message ?? 'not found'}`);
  return data as CampaignRow;
}

async function fetchAccountMailboxes(
  supabase: SupabaseClient,
  accountId: string,
  mailboxLimit: number | null,
): Promise<MailboxRow[]> {
  const { data, error } = await supabase
    .from('mailboxes')
    .select('id, account_id, email_address, display_name, imap_host, imap_port, imap_username, imap_password, imap_use_ssl, status, deleted_at')
    .eq('account_id', accountId)
    .is('deleted_at', null)
    .order('email_address', { ascending: true });
  if (error) throw new Error(`Failed to load account mailboxes: ${error.message}`);
  const rows = (data ?? []) as MailboxRow[];
  return mailboxLimit != null ? rows.slice(0, mailboxLimit) : rows;
}

function selectMailboxSlice(mailboxes: MailboxRow[], args: Args): MailboxRow[] {
  let selected = [...mailboxes];
  if (args.mailboxEmails && args.mailboxEmails.length > 0) {
    const wanted = new Set(args.mailboxEmails.map((value) => value.toLowerCase()));
    selected = selected.filter((mailbox) => wanted.has(mailbox.email_address.toLowerCase()));
  }
  if (args.mailboxStart != null || args.mailboxCount != null) {
    const start = args.mailboxStart ?? 0;
    const end = args.mailboxCount != null ? start + args.mailboxCount : undefined;
    selected = selected.slice(start, end);
  }
  return selected;
}

const SENDER_EMAIL_SAMPLE_LIMIT = 20;
/** Both Foot Traffic Smartlead campaigns used 100 of the ~150 shared InboxAlways mailboxes. */
const KNOWN_HISTORICAL_MAILBOX_ASSIGNMENT = 100;
/** Operator expectation: ~6k Smartlead sends across both Foot Traffic campaigns combined since May 2026. */
const OPERATOR_EXPECTED_COMBINED_SENT = 6000;
const CAMPAIGN_SENT_RECOVERY_RATIO_FLOOR = 0.5;

const FOOT_TRAFFIC_LEAD_MAGNET_CAMPAIGN_ID = '315e72b5-3ca0-4258-9307-b5e786e6868a';
const FOOT_TRAFFIC_SCRAPED_EMAILS_2_CAMPAIGN_ID = 'eecac452-8248-4809-8a45-26761b5c5a31';

const FOOT_TRAFFIC_RECOVERY_PAIRS: Record<
  string,
  { companionSmartleadId: number; companionName: string; companionSince: string }
> = {
  [FOOT_TRAFFIC_LEAD_MAGNET_CAMPAIGN_ID]: {
    companionSmartleadId: 3332649,
    companionName: 'Foot Traffic - Scraped Emails 2',
    companionSince: '2026-05-13',
  },
  [FOOT_TRAFFIC_SCRAPED_EMAILS_2_CAMPAIGN_ID]: {
    companionSmartleadId: 3295280,
    companionName: 'Foot Traffic - Apollo Contacts (Lead Magnet)',
    companionSince: '2026-05-06',
  },
};

const FOOT_TRAFFIC_LEAD_COUNTS: Record<string, number> = {
  [FOOT_TRAFFIC_LEAD_MAGNET_CAMPAIGN_ID]: 3933,
  [FOOT_TRAFFIC_SCRAPED_EMAILS_2_CAMPAIGN_ID]: 2752,
};

type SmartleadSentExpectationContext = {
  thisCampaignSent: number | null;
  companionCampaignSent: number | null;
  combinedSent: number | null;
  companionCampaignName: string | null;
};

function proratedOperatorExpectationForCampaign(campaignId: string): number | null {
  const leadCount = FOOT_TRAFFIC_LEAD_COUNTS[campaignId];
  if (leadCount == null) return null;
  const totalLeads = Object.values(FOOT_TRAFFIC_LEAD_COUNTS).reduce((sum, count) => sum + count, 0);
  return Math.round(OPERATOR_EXPECTED_COMBINED_SENT * (leadCount / totalLeads));
}

function createEmptyCampaignSentExpectation(sinceDate: string): CampaignSentExpectationDiagnostics {
  return {
    sinceDate,
    operatorExpectedCombinedSent: OPERATOR_EXPECTED_COMBINED_SENT,
    smartleadReportedSentThisCampaign: null,
    smartleadReportedSentCompanion: null,
    smartleadReportedSentCombined: null,
    companionCampaignName: null,
    expectedTaggedSent: 0,
    imapTaggedSent: 0,
    imapToLead: 0,
    projectedTaggedSent: null,
    recoveryRatio: null,
    projectedRecoveryRatio: null,
    meetsOperatorExpectation: false,
    warnings: [],
  };
}

async function fetchSmartleadSentSince(
  apiKey: string,
  smartleadCampaignId: number,
  since: Date,
  until: Date | null,
): Promise<number | null> {
  const startDate = since.toISOString().slice(0, 10);
  const endDate = (until ?? new Date()).toISOString().slice(0, 10);
  try {
    const byDay = await fetchSmartleadCampaignStatsByDay(apiKey, smartleadCampaignId, startDate, endDate);
    if (byDay.length === 0) return null;
    return byDay.reduce((sum, row) => sum + row.sent, 0);
  } catch {
    return null;
  }
}

async function fetchFootTrafficSentContext(
  apiKey: string,
  campaign: CampaignRow,
  since: Date,
  until: Date | null,
): Promise<SmartleadSentExpectationContext> {
  const pair = FOOT_TRAFFIC_RECOVERY_PAIRS[campaign.id];
  const thisCampaignSent =
    campaign.smartlead_campaign_id != null
      ? await fetchSmartleadSentSince(apiKey, campaign.smartlead_campaign_id, since, until)
      : null;

  let companionCampaignSent: number | null = null;
  let companionCampaignName: string | null = pair?.companionName ?? null;
  if (pair) {
    const companionSince = new Date(`${pair.companionSince}T00:00:00.000Z`);
    const companionSinceEffective = since > companionSince ? since : companionSince;
    companionCampaignSent = await fetchSmartleadSentSince(
      apiKey,
      pair.companionSmartleadId,
      companionSinceEffective,
      until,
    );
  }

  const combinedSent =
    thisCampaignSent != null || companionCampaignSent != null
      ? (thisCampaignSent ?? 0) + (companionCampaignSent ?? 0)
      : null;

  return {
    thisCampaignSent,
    companionCampaignSent,
    combinedSent,
    companionCampaignName,
  };
}

function finalizeCampaignSentExpectation(
  since: Date,
  campaignId: string,
  senders: SenderDiagnostics,
  totals: AuditDiagnostics['totals'],
  context: SmartleadSentExpectationContext,
): CampaignSentExpectationDiagnostics {
  const sinceDate = since.toISOString().slice(0, 10);
  const proratedOperator = proratedOperatorExpectationForCampaign(campaignId);
  const expectedTaggedSent =
    context.thisCampaignSent ?? proratedOperator ?? Math.round(OPERATOR_EXPECTED_COMBINED_SENT / 2);
  const imapTaggedSent = totals.sent.tagged;
  const imapToLead = totals.sent.toLead;
  const selected = senders.selectedForScan;
  const pool = senders.furnaceMailboxCount;
  const projectedTaggedSent =
    selected > 0 && selected < pool ? Math.round(imapTaggedSent * (pool / selected)) : imapTaggedSent;
  const recoveryRatio = expectedTaggedSent > 0 ? imapTaggedSent / expectedTaggedSent : null;
  const projectedRecoveryRatio = expectedTaggedSent > 0 ? projectedTaggedSent / expectedTaggedSent : null;
  const ratioForGate = projectedRecoveryRatio ?? recoveryRatio;
  const warnings: string[] = [];
  if (context.thisCampaignSent == null) {
    warnings.push(
      `Smartlead sent count for this campaign since ${sinceDate} unavailable${proratedOperator != null ? `; using prorated operator share ${proratedOperator} of combined ${OPERATOR_EXPECTED_COMBINED_SENT}` : '.'}`,
    );
  }
  if (context.combinedSent != null && Math.abs(context.combinedSent - OPERATOR_EXPECTED_COMBINED_SENT) > 500) {
    warnings.push(
      `Smartlead combined sends for both Foot Traffic campaigns (${context.combinedSent}) differ from operator expectation (${OPERATOR_EXPECTED_COMBINED_SENT}).`,
    );
  }
  if (ratioForGate != null && ratioForGate < CAMPAIGN_SENT_RECOVERY_RATIO_FLOOR) {
    warnings.push(
      `IMAP tagged Sent for this campaign (${imapTaggedSent}${selected < pool ? `, ~${projectedTaggedSent} projected across ${pool} mailboxes` : ''}) is below ${Math.round(CAMPAIGN_SENT_RECOVERY_RATIO_FLOOR * 100)}% of this campaign's expected sends (${expectedTaggedSent} Smartlead/operator). Shared Sent folders also contain the companion campaign's mail. Investigate Sent retention or matching if this stays low after full scan.`,
    );
  }
  if (imapToLead > imapTaggedSent) {
    warnings.push('toLead exceeds tagged count; copy-match tagging may be undercounting campaign Sent rows.');
  }
  return {
    sinceDate,
    operatorExpectedCombinedSent: OPERATOR_EXPECTED_COMBINED_SENT,
    smartleadReportedSentThisCampaign: context.thisCampaignSent,
    smartleadReportedSentCompanion: context.companionCampaignSent,
    smartleadReportedSentCombined: context.combinedSent,
    companionCampaignName: context.companionCampaignName,
    expectedTaggedSent,
    imapTaggedSent,
    imapToLead,
    projectedTaggedSent: selected < pool ? projectedTaggedSent : null,
    recoveryRatio,
    projectedRecoveryRatio,
    meetsOperatorExpectation: ratioForGate != null && ratioForGate >= CAMPAIGN_SENT_RECOVERY_RATIO_FLOOR,
    warnings,
  };
}

function isBlockingMailboxScanFailure(row: AuditOutput['sentFolderUsage'][number]): boolean {
  if (row.errors.length === 0) return false;
  if (row.scannedSent > 0 || row.scannedInbox > 0) return false;
  return true;
}

function computeSenderCoverageDiagnostics(
  furnaceMailboxCount: number,
  selectedForScan: number,
): Pick<SenderDiagnostics, 'knownHistoricalAssignmentCount' | 'minBatchForCoverageGuarantee' | 'meetsCoverageGuarantee'> {
  const knownHistoricalAssignmentCount =
    furnaceMailboxCount >= KNOWN_HISTORICAL_MAILBOX_ASSIGNMENT ? KNOWN_HISTORICAL_MAILBOX_ASSIGNMENT : null;
  const minBatchForCoverageGuarantee =
    knownHistoricalAssignmentCount != null && furnaceMailboxCount > knownHistoricalAssignmentCount
      ? furnaceMailboxCount - knownHistoricalAssignmentCount + 1
      : null;
  return {
    knownHistoricalAssignmentCount,
    minBatchForCoverageGuarantee,
    meetsCoverageGuarantee:
      minBatchForCoverageGuarantee != null && selectedForScan >= minBatchForCoverageGuarantee,
  };
}

async function resolveAuditMailboxes(
  supabase: SupabaseClient,
  campaign: CampaignRow,
  args: Args,
): Promise<{ mailboxes: MailboxRow[]; senders: SenderDiagnostics }> {
  const warnings: string[] = [];
  const allFurnace = await fetchAccountMailboxes(supabase, campaign.account_id, null);
  let basePool = allFurnace;
  let source: SenderDiagnostics['source'] = 'furnace_account_mailboxes';
  let smartleadAssignedCount = 0;
  let intersectionCount = 0;
  let smartleadOnlyEmails: string[] = [];
  let furnaceOnlyEmails: string[] = [];

  if (!args.allAccountMailboxes && args.smartleadApiKey && campaign.smartlead_campaign_id) {
    try {
      const accounts = await fetchSmartleadCampaignEmailAccounts(
        args.smartleadApiKey,
        campaign.smartlead_campaign_id,
      );
      smartleadAssignedCount = accounts.length;
      const smartleadEmailSet = new Set(accounts.map((account) => account.from_email));
      const furnaceEmailSet = new Set(
        allFurnace
          .map((mailbox) => normalizeEmail(mailbox.email_address))
          .filter((email): email is string => !!email),
      );

      if (accounts.length === 0) {
        warnings.push(
          `Smartlead campaign ${campaign.smartlead_campaign_id} email-accounts API returned zero accounts (mailboxes were reconnected and unassigned). Using Furnace pool; scan at least ${computeSenderCoverageDiagnostics(allFurnace.length, 0).minBatchForCoverageGuarantee ?? 51} mailboxes to guarantee a historically assigned sender.`,
        );
        basePool = allFurnace;
      } else {
        smartleadOnlyEmails = accounts
          .filter((account) => !furnaceEmailSet.has(account.from_email))
          .map((account) => account.from_email)
          .slice(0, SENDER_EMAIL_SAMPLE_LIMIT);

        furnaceOnlyEmails = allFurnace
          .filter((mailbox) => {
            const email = normalizeEmail(mailbox.email_address);
            return email && !smartleadEmailSet.has(email);
          })
          .map((mailbox) => mailbox.email_address)
          .slice(0, SENDER_EMAIL_SAMPLE_LIMIT);

        const intersection = allFurnace.filter((mailbox) => {
          const email = normalizeEmail(mailbox.email_address);
          return email && smartleadEmailSet.has(email);
        });
        intersectionCount = intersection.length;

        if (intersection.length === 0) {
          throw new Error(
            `No Furnace mailboxes match Smartlead campaign ${campaign.smartlead_campaign_id} email-accounts (${accounts.length} Smartlead-assigned, ${allFurnace.length} Furnace).`,
          );
        }

        basePool = intersection;
        source = 'smartlead_campaign_email_accounts';
      }
    } catch (error) {
      warnings.push(
        `Smartlead email-account fetch failed: ${error instanceof Error ? error.message : String(error)}; using all Furnace account mailboxes.`,
      );
      basePool = allFurnace;
    }
  } else if (args.allAccountMailboxes) {
    warnings.push('Scanning all Furnace account mailboxes (--all-account-mailboxes).');
  } else if (!args.smartleadApiKey) {
    warnings.push('No SMARTLEAD_API_KEY; using all Furnace account mailboxes.');
  } else if (!campaign.smartlead_campaign_id) {
    warnings.push('Campaign has no smartlead_campaign_id; using all Furnace account mailboxes.');
  }

  let mailboxes = selectMailboxSlice(basePool, args);
  if (args.mailboxLimit != null) {
    mailboxes = mailboxes.slice(0, args.mailboxLimit);
  }
  if (mailboxes.length === 0) {
    throw new Error('Mailbox selection produced zero mailboxes after filters.');
  }

  const coverage = computeSenderCoverageDiagnostics(allFurnace.length, mailboxes.length);
  if (
    source === 'furnace_account_mailboxes' &&
    coverage.minBatchForCoverageGuarantee != null &&
    mailboxes.length < coverage.minBatchForCoverageGuarantee
  ) {
    warnings.push(
      `Scanning ${mailboxes.length} of ${allFurnace.length} mailboxes; expand to at least ${coverage.minBatchForCoverageGuarantee} to guarantee one of the ${KNOWN_HISTORICAL_MAILBOX_ASSIGNMENT} historically assigned senders is included.`,
    );
  }

  return {
    mailboxes,
    senders: {
      source,
      smartleadAssignedCount,
      furnaceMailboxCount: allFurnace.length,
      intersectionCount,
      smartleadOnlyEmails,
      furnaceOnlyEmails,
      selectedForScan: mailboxes.length,
      ...coverage,
      warnings,
    },
  };
}

async function fetchFurnaceLeadJoinData(
  supabase: SupabaseClient,
  campaign: CampaignRow,
): Promise<{
  byEmail: Map<string, FurnaceLeadJoinRow>;
  bySmartleadId: Map<number, FurnaceLeadJoinRow>;
  overlapCampaignsByEmail: Map<string, Set<string>>;
}> {
  const [{ data: leads, error: leadsError }, { data: enrollments, error: enrollmentsError }, { data: accountLeads, error: accountLeadsError }] =
    await Promise.all([
      supabase
        .from('leads')
        .select('id, email, smartlead_lead_id')
        .eq('campaign_id', campaign.id),
      supabase
        .from('enrollments')
        .select('id, lead_id')
        .eq('campaign_id', campaign.id),
      supabase
        .from('leads')
        .select('email, campaign_id')
        .eq('account_id', campaign.account_id)
        .not('email', 'is', null),
    ]);
  if (leadsError) throw new Error(`Failed to load campaign leads: ${leadsError.message}`);
  if (enrollmentsError) throw new Error(`Failed to load enrollments: ${enrollmentsError.message}`);
  if (accountLeadsError) throw new Error(`Failed to load account lead overlap data: ${accountLeadsError.message}`);

  const enrollmentByLeadId = new Map<string, string>();
  for (const row of (enrollments ?? []) as EnrollmentRow[]) {
    if (!enrollmentByLeadId.has(row.lead_id)) enrollmentByLeadId.set(row.lead_id, row.id);
  }

  const overlapCampaignsByEmail = new Map<string, Set<string>>();
  for (const row of (accountLeads ?? []) as Array<{ email: string | null; campaign_id: string }>) {
    const email = normalizeEmail(row.email);
    if (!email) continue;
    const set = overlapCampaignsByEmail.get(email) ?? new Set<string>();
    set.add(row.campaign_id);
    overlapCampaignsByEmail.set(email, set);
  }

  const byEmail = new Map<string, FurnaceLeadJoinRow>();
  const bySmartleadId = new Map<number, FurnaceLeadJoinRow>();
  for (const lead of (leads ?? []) as LeadRow[]) {
    const email = normalizeEmail(lead.email);
    if (!email) continue;
    const row: FurnaceLeadJoinRow = {
      leadId: lead.id,
      enrollmentId: enrollmentByLeadId.get(lead.id) ?? null,
      smartleadLeadId: lead.smartlead_lead_id ?? null,
      email,
    };
    byEmail.set(email, row);
    if (lead.smartlead_lead_id != null) {
      bySmartleadId.set(lead.smartlead_lead_id, row);
    }
  }

  return { byEmail, bySmartleadId, overlapCampaignsByEmail };
}

async function resolveRecipientLeadMap(
  supabase: SupabaseClient,
  campaign: CampaignRow,
  smartleadApiKey: string | null,
): Promise<{ leadMap: Map<string, LeadRecord>; recipients: RecipientDiagnostics }> {
  const joinData = await fetchFurnaceLeadJoinData(supabase, campaign);
  const warnings: string[] = [];

  if (smartleadApiKey && campaign.smartlead_campaign_id) {
    try {
      const smartleadLeads = await fetchSmartleadLeads(smartleadApiKey, campaign.smartlead_campaign_id);
      let furnaceMappedCount = 0;
      let unmappedSmartleadCount = 0;
      const leadMap = new Map<string, LeadRecord>();

      for (const sl of smartleadLeads) {
        const email = normalizeEmail(sl.email);
        if (!email || !Number.isFinite(sl.id) || sl.id <= 0) continue;
        const furnace = joinData.byEmail.get(email) ?? joinData.bySmartleadId.get(sl.id);
        const hasFurnaceMapping = !!furnace;
        if (hasFurnaceMapping) furnaceMappedCount += 1;
        else unmappedSmartleadCount += 1;

        leadMap.set(email, {
          leadId: furnace?.leadId ?? null,
          enrollmentId: furnace?.enrollmentId ?? null,
          smartleadLeadId: sl.id,
          email,
          overlapCount: joinData.overlapCampaignsByEmail.get(email)?.size ?? 1,
          hasFurnaceMapping,
        });
      }

      return {
        leadMap,
        recipients: {
          source: 'smartlead_campaign_leads',
          smartleadLeadCount: smartleadLeads.length,
          furnaceMappedCount,
          unmappedSmartleadCount,
          warnings,
        },
      };
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : String(error));
    }
  } else if (!campaign.smartlead_campaign_id) {
    warnings.push('Campaign has no smartlead_campaign_id; using Furnace campaign leads only.');
  } else {
    warnings.push('SMARTLEAD_API_KEY not set; using Furnace campaign leads only.');
  }

  const leadMap = new Map<string, LeadRecord>();
  for (const row of joinData.byEmail.values()) {
    leadMap.set(row.email, {
      leadId: row.leadId,
      enrollmentId: row.enrollmentId,
      smartleadLeadId: row.smartleadLeadId,
      email: row.email,
      overlapCount: joinData.overlapCampaignsByEmail.get(row.email)?.size ?? 1,
      hasFurnaceMapping: true,
    });
  }

  return {
    leadMap,
    recipients: {
      source: 'furnace_campaign_leads',
      smartleadLeadCount: 0,
      furnaceMappedCount: leadMap.size,
      unmappedSmartleadCount: 0,
      warnings,
    },
  };
}
function parseCopyJson(copyPath: string): CopyConfig {
  const raw = readFileSync(copyPath, 'utf8');
  const parsed = JSON.parse(raw) as { campaignId?: string; name?: string; steps?: CopyStep[] };
  const steps = Array.isArray(parsed.steps) ? parsed.steps.filter((step) => typeof step.subject === 'string' && step.subject.trim()) : [];
  return {
    campaignId: parsed.campaignId ?? '',
    name: parsed.name,
    steps: steps.map((step) => ({
      label: step.label,
      subject: step.subject,
      bodyFingerprints: step.bodyFingerprints?.filter((value) => typeof value === 'string' && value.trim()) ?? [],
    })),
    source: 'manual_json',
  };
}

async function fetchCopyFromSmartlead(
  campaign: CampaignRow,
  apiKey: string,
): Promise<CopyConfig | null> {
  if (!campaign.smartlead_campaign_id) return null;
  const url =
    `${SMARTLEAD_BASE}/campaigns/${campaign.smartlead_campaign_id}/sequences` +
    `?api_key=${encodeURIComponent(apiKey)}`;
  const res = await smartleadRequest({ url });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Smartlead sequences API failed (${res.status}): ${body.slice(0, 200)}`);
  }
  const raw = await res.json() as unknown;
  const rows = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as any)?.data)
      ? (raw as any).data
      : [];
  const steps: CopyStep[] = [];
  for (const row of rows as Array<Record<string, unknown>>) {
    const subject = typeof row.subject === 'string' ? row.subject.trim() : '';
    const emailBody = typeof row.email_body === 'string' ? row.email_body.trim() : '';
    const variants = Array.isArray(row.sequence_variants)
      ? (row.sequence_variants as Array<Record<string, unknown>>).filter((variant) => variant?.is_deleted !== true)
      : [];
    const seqNumber =
      typeof row.seq_number === 'number'
        ? row.seq_number
        : typeof row.seq_number === 'string'
          ? Number(row.seq_number)
          : steps.length + 1;
    if (variants.length > 0) {
      for (const variant of variants) {
        const variantLabel = typeof variant.variant_label === 'string' ? variant.variant_label.trim() : 'variant';
        const variantSubject = typeof variant.subject === 'string' ? variant.subject.trim() : subject;
        const variantBody = typeof variant.email_body === 'string' ? variant.email_body.trim() : emailBody;
        if (!variantSubject && !variantBody) continue;
        steps.push({
          label: `sequence_${Number.isFinite(seqNumber) ? seqNumber : steps.length + 1}_${variantLabel || 'variant'}`,
          subject: variantSubject || '(No subject)',
          bodyFingerprints: variantBody ? [bodySnippet(null, variantBody, 120)] : [],
        });
      }
      continue;
    }
    if (!subject && !emailBody) continue;
    steps.push({
      label: `sequence_${Number.isFinite(seqNumber) ? seqNumber : steps.length + 1}`,
      subject: subject || '(No subject)',
      bodyFingerprints: emailBody ? [bodySnippet(null, emailBody, 120)] : [],
    });
  }
  return {
    campaignId: campaign.id,
    name: campaign.name,
    steps,
    source: 'smartlead_api',
  };
}

async function resolveCopyConfig(
  campaign: CampaignRow,
  args: Args,
): Promise<{ copy: CopyConfig | null; warnings: string[] }> {
  const warnings: string[] = [];
  if (args.copyPath) {
    return { copy: parseCopyJson(args.copyPath), warnings };
  }
  if (args.smartleadApiKey) {
    try {
      const copy = await fetchCopyFromSmartlead(campaign, args.smartleadApiKey);
      if (copy && copy.steps.length > 0) return { copy, warnings };
      warnings.push('Smartlead sequences API returned no usable copy rows.');
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : String(error));
    }
  }
  return { copy: null, warnings };
}

function subjectMatchesCopy(normalizedSubject: string, copy: CopyConfig | null): { matched: boolean; stepLabel: string | null } {
  if (!copy) return { matched: false, stepLabel: null };
  for (const step of copy.steps) {
    const stepCore = normalizeSubjectCore(step.subject);
    if (!stepCore) continue;
    if (normalizedSubject === stepCore || normalizedSubject.includes(stepCore) || stepCore.includes(normalizedSubject)) {
      return { matched: true, stepLabel: step.label ?? null };
    }
  }
  return { matched: false, stepLabel: null };
}

function bodyMatchesCopy(text: string | null, html: string | null, copy: CopyConfig | null): { matched: boolean; stepLabel: string | null } {
  if (!copy) return { matched: false, stepLabel: null };
  const normalizedBody = normalizeBodyText(text || textFromHtml(html));
  if (!normalizedBody) return { matched: false, stepLabel: null };
  for (const step of copy.steps) {
    for (const fingerprint of step.bodyFingerprints ?? []) {
      const normalizedFingerprint = normalizeBodyText(fingerprint);
      if (normalizedFingerprint && normalizedBody.includes(normalizedFingerprint)) {
        return { matched: true, stepLabel: step.label ?? null };
      }
    }
  }
  return { matched: false, stepLabel: null };
}

async function connectMailbox(mailbox: MailboxRow, onError?: (error: Error) => void): Promise<ImapFlow> {
  const client = new ImapFlow({
    host: mailbox.imap_host,
    port: mailbox.imap_port,
    secure: mailbox.imap_use_ssl,
    auth: {
      user: mailbox.imap_username,
      pass: mailbox.imap_password,
    },
    logger: false,
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 120_000,
  });
  client.on('error', (error) => {
    onError?.(error instanceof Error ? error : new Error(String(error)));
  });
  await client.connect();
  return client;
}

type SentFolderDiscovery = {
  selectedPath: string | null;
  inspected: string[];
  discovered: string[];
  errors: string[];
};

function sentFolderScore(folder: Record<string, unknown>): number {
  const path = String(folder.path ?? '');
  const lower = path.toLowerCase();
  const specialUse = String((folder as { specialUse?: string }).specialUse ?? '').toLowerCase();
  const flags = Array.isArray((folder as { flags?: unknown[] }).flags)
    ? ((folder as { flags?: unknown[] }).flags ?? []).map((value) => String(value).toLowerCase())
    : [];

  let score = 0;
  if (specialUse.includes('sent')) score += 100;
  if (flags.some((value) => value.includes('sent'))) score += 80;
  if (lower === 'sent') score += 70;
  if (lower.endsWith('/sent') || lower.endsWith('.sent')) score += 60;
  if (lower.includes('sent mail')) score += 55;
  if (lower.includes('sent items')) score += 50;
  if (lower.includes('sent messages')) score += 45;
  if (lower.includes('sent')) score += 40;
  if (lower === 'outbox') score += 20;
  if (lower === 'archive') score += 10;
  if (lower === 'conversation history') score += 5;
  return score;
}

async function resolveSentFolder(client: ImapFlow): Promise<SentFolderDiscovery> {
  const errors: string[] = [];
  const inspected: string[] = [];
  let folders: Array<Record<string, unknown>> = [];
  try {
    await openInboxResilient(client);
  } catch (error) {
    const err = error as { message?: string; responseStatus?: string; executedCommand?: string };
    errors.push(
      `open INBOX before Sent discovery failed: ${err.message ?? String(error)}${
        err.responseStatus ? ` [${err.responseStatus}]` : ''
      }${err.executedCommand ? ` (${err.executedCommand})` : ''}`,
    );
  }
  try {
    const listed = await client.list();
    folders = Array.isArray(listed) ? (listed as Array<Record<string, unknown>>) : [];
  } catch (error) {
    const err = error as { message?: string; responseStatus?: string; executedCommand?: string };
    errors.push(
      `LIST failed: ${err.message ?? String(error)}${err.responseStatus ? ` [${err.responseStatus}]` : ''}${
        err.executedCommand ? ` (${err.executedCommand})` : ''
      }`,
    );
  }

  if (folders.length === 0) {
    const fallbackPatterns = ['INBOX*', '%', 'Sent*', '*Sent*'];
    for (const pattern of fallbackPatterns) {
      try {
        const listed = await client.run('LIST', '', pattern, { listOnly: true }) as Array<Record<string, unknown>> | null;
        if (Array.isArray(listed)) {
          folders.push(...listed);
        }
      } catch (error) {
        const err = error as { message?: string; responseStatus?: string; executedCommand?: string };
        errors.push(
          `LIST ${pattern} failed: ${err.message ?? String(error)}${err.responseStatus ? ` [${err.responseStatus}]` : ''}${
            err.executedCommand ? ` (${err.executedCommand})` : ''
          }`,
        );
      }
    }
  }

  folders = folders.filter((folder, index, array) => {
    const path = String(folder.path ?? '');
    return !!path && array.findIndex((candidate) => String(candidate.path ?? '') === path) === index;
  });
  for (const folder of folders) {
    const path = String(folder.path ?? '');
    if (path) {
      client.folders.set(path, folder);
    }
  }

  const ranked = folders
    .map((folder) => ({
      path: String(folder.path ?? ''),
      score: sentFolderScore(folder),
    }))
    .filter((folder) => folder.path && folder.score > 0)
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));

  const hardcoded = [
    'Sent',
    'Sent Mail',
    'Sent Items',
    'Sent Messages',
    'INBOX.Sent',
    'INBOX.Sent Items',
    'INBOX.Sent Mail',
    'INBOX.Sent Messages',
    'INBOX/Sent',
    'INBOX/Sent Items',
    'INBOX/Sent Mail',
    '[Gmail]/Sent Mail',
  ];
  const candidates = [...new Set([...ranked.map((folder) => folder.path), ...hardcoded])];

  for (const candidate of candidates) {
    inspected.push(candidate);
    try {
      await openMailboxPath(client, candidate);
      return { selectedPath: candidate, inspected, discovered: folders.map((folder) => String(folder.path ?? '')), errors };
    } catch (error) {
      const err = error as { message?: string; responseStatus?: string; executedCommand?: string };
      errors.push(
        `open ${candidate}: ${err.message ?? String(error)}${err.responseStatus ? ` [${err.responseStatus}]` : ''}${
          err.executedCommand ? ` (${err.executedCommand})` : ''
        }`,
      );
    }
  }

  return { selectedPath: null, inspected, discovered: folders.map((folder) => String(folder.path ?? '')), errors };
}

function isExchangeLsubError(error: unknown): boolean {
  const err = error as { executedCommand?: string; responseStatus?: string };
  return (
    err.responseStatus === 'BAD' &&
    typeof err.executedCommand === 'string' &&
    err.executedCommand.toUpperCase().includes('LSUB')
  );
}

async function openMailboxPath(client: ImapFlow, path: string): Promise<void> {
  try {
    await client.mailboxOpen(path);
  } catch (error) {
    if (!isExchangeLsubError(error)) {
      throw error;
    }
    client.folders.set(path, {
      path,
      listed: true,
      subscribed: true,
      flags: new Set<string>(),
      delimiter: '/',
    });
    await client.mailboxOpen(path);
  }
}

async function openInboxResilient(client: ImapFlow): Promise<void> {
  try {
    await openImapInbox(client);
  } catch (error) {
    const err = error as { message?: string; executedCommand?: string };
    const command = err.executedCommand?.toUpperCase() ?? '';
    const isFolderLookupError =
      command.includes('LIST') || command.includes('LSUB') || command.includes('INBOX');
    if (!isFolderLookupError) {
      throw error;
    }
    client.folders.set('INBOX', {
      path: 'INBOX',
      listed: true,
      subscribed: true,
      flags: new Set<string>(),
      delimiter: '/',
    });
    await client.mailboxOpen('INBOX');
  }
}

async function fetchFolderUids(
  client: ImapFlow,
  since: Date,
  until: Date | null,
): Promise<number[]> {
  const query: { since: Date; before?: Date } = { since };
  if (until) {
    const before = new Date(until);
    before.setUTCDate(before.getUTCDate() + 1);
    query.before = before;
  }
  const results = await client.search(query, { uid: true });
  return Array.isArray(results) ? results : [];
}

async function parseImapMessage(client: ImapFlow, uid: number): Promise<{
  uid: number;
  messageId: string | null;
  rawMessageId: string | null;
  inReplyTo: string | null;
  messageReferences: string | null;
  subject: string;
  from: string | null;
  to: string[];
  date: Date;
  bodyText: string | null;
  bodyHtml: string | null;
}> {
  const fetched = await client.fetchOne(uid, { source: true, uid: true }, { uid: true });
  if (!fetched?.source) throw new Error(`No source returned for uid ${uid}`);
  const mail = await simpleParser(fetched.source as Buffer);
  const refs = mail.references;
  const referencesRaw =
    refs == null
      ? null
      : Array.isArray(refs)
        ? refs.filter(Boolean).join(' ')
        : String(refs);
  return {
    uid,
    messageId: normalizeMessageId(mail.messageId ?? null),
    rawMessageId: mail.messageId ?? null,
    inReplyTo: normalizeMessageId(mail.inReplyTo ?? null),
    messageReferences: normalizeReferences(referencesRaw),
    subject: mail.subject ?? '(No subject)',
    from: normalizeEmail(mail.from?.value?.[0]?.address ?? null),
    to: collectAddressList(mail.to),
    date: mail.date ?? new Date(),
    bodyText: typeof mail.text === 'string' ? mail.text.trim() : null,
    bodyHtml: typeof mail.html === 'string' ? mail.html.trim() : null,
  };
}

async function runSentFolderSpike(
  supabase: SupabaseClient,
  campaign: CampaignRow,
  args: Args,
): Promise<SpikeResult[]> {
  const { leadMap } = await resolveRecipientLeadMap(supabase, campaign, args.smartleadApiKey);
  const spikeArgs: Args = {
    ...args,
    mailboxLimit: args.mailboxLimit ?? 3,
  };
  const { mailboxes } = await resolveAuditMailboxes(supabase, campaign, spikeArgs);
  const results: SpikeResult[] = [];

  for (const mailbox of mailboxes) {
    const item: SpikeResult = {
      mailboxEmail: mailbox.email_address,
      sentFolderPath: null,
      discoveredFolders: [],
      sampledSentMessages: 0,
      sentMessagesScanned: 0,
      sampleAnyMessageIds: [],
      sampleAnySubjects: [],
      sampleMessageIds: [],
      sampleSubjects: [],
      errors: [],
    };

    let client: ImapFlow | null = null;
    try {
      client = await connectMailbox(mailbox);
      const sentFolder = await resolveSentFolder(client);
      item.errors.push(...sentFolder.errors);
      item.sentFolderPath = sentFolder.selectedPath;
      item.discoveredFolders = sentFolder.discovered;
      if (!sentFolder.selectedPath) {
        results.push(item);
        continue;
      }

      const uids = await fetchFolderUids(client, args.since, args.until);
      const recentUids = uids.slice(-args.spikeMessages);
      for (const uid of recentUids) {
        const message = await parseImapMessage(client, uid);
        if (args.until && message.date > args.until) continue;
        item.sampledSentMessages += 1;
        if (message.messageId && item.sampleAnyMessageIds.length < 5) {
          item.sampleAnyMessageIds.push(message.messageId);
        }
        if (item.sampleAnySubjects.length < 5) {
          item.sampleAnySubjects.push(message.subject);
        }
        if (message.to.some((email) => leadMap.has(email))) {
          item.sentMessagesScanned += 1;
          if (message.messageId) item.sampleMessageIds.push(message.messageId);
          item.sampleSubjects.push(message.subject);
        }
      }
    } catch (error) {
      item.errors.push(error instanceof Error ? error.message : String(error));
    } finally {
      if (client) {
        try {
          await client.logout();
        } catch {
          // ignore
        }
      }
    }
    results.push(item);
  }

  return results;
}

function writeJson(path: string, data: unknown): void {
  const resolvedPath = resolve(process.cwd(), path);
  mkdirSync(dirname(resolvedPath), { recursive: true });
  writeFileSync(resolvedPath, JSON.stringify(data, null, 2));
}

function evaluateAuditGate(audit: AuditOutput): { status: 'go' | 'expand_sample' | 'no_go'; reasons: string[] } {
  const blockedMailboxes = audit.sentFolderUsage.filter(isBlockingMailboxScanFailure).length;
  if (blockedMailboxes >= Math.max(3, Math.ceil(audit.scannedMailboxes / 2))) {
    return {
      status: 'no_go',
      reasons: [`${blockedMailboxes} mailboxes failed to scan Sent/INBOX (not non-blocking folder-list noise).`],
    };
  }
  const expectation = audit.diagnostics.campaignSentExpectation;
  const recoveryRatio = expectation?.projectedRecoveryRatio ?? expectation?.recoveryRatio ?? null;
  if (recoveryRatio != null && recoveryRatio < CAMPAIGN_SENT_RECOVERY_RATIO_FLOOR) {
    const ratioPct = `${Math.round(recoveryRatio * 100)}%`;
    const fullPool = audit.scannedMailboxes >= audit.diagnostics.senders.furnaceMailboxCount;
    return {
      status: fullPool ? 'no_go' : 'expand_sample',
      reasons: [
        `IMAP tagged Sent ${expectation!.imapTaggedSent} vs ${expectation!.expectedTaggedSent} Smartlead/operator expected sends (${ratioPct}). ${fullPool ? 'Full mailbox pool scanned — investigate Sent retention or matching.' : 'Expand to full mailbox pool before concluding.'}`,
      ],
    };
  }
  if (audit.sentIndexSize === 0) {
    const toLead = audit.diagnostics.totals.sent.toLead;
    const senders = audit.diagnostics.senders;
    const minBatch = senders.minBatchForCoverageGuarantee;

    if (toLead === 0 && !senders.meetsCoverageGuarantee && minBatch != null) {
      return {
        status: 'expand_sample',
        reasons: [
          `No Sent messages matched campaign recipients (toLead=0). Scanned ${audit.scannedMailboxes} mailboxes; expand to at least ${minBatch} to guarantee one historically assigned sender (${senders.knownHistoricalAssignmentCount ?? KNOWN_HISTORICAL_MAILBOX_ASSIGNMENT} of ${senders.furnaceMailboxCount} pool).`,
        ],
      };
    }

    if (toLead === 0 && senders.meetsCoverageGuarantee) {
      return {
        status: 'no_go',
        reasons: [
          `Scanned ${audit.scannedMailboxes} mailboxes (meets ${minBatch ?? 51}+ coverage guarantee) but toLead is still 0; Sent folders likely contain warmup or unrelated traffic, not campaign outbounds.`,
        ],
      };
    }

    return {
      status: audit.scannedMailboxes >= 3 ? 'no_go' : 'expand_sample',
      reasons: ['No tagged Sent messages were found, so the outbound matching assumptions need more evidence before a broad run.'],
    };
  }
  if (audit.candidates.length > 0 || audit.review.length > 0) {
    return {
      status: 'go',
      reasons: ['Tagged Sent rows were found and the sample produced candidate or review rows worth operator review.'],
    };
  }
  return {
    status: 'expand_sample',
    reasons: ['Tagged Sent rows were found, but the sample did not yet produce candidate threads; widen the mailbox slice before an overnight pass.'],
  };
}

function resolveCheckpointPath(args: Args): string | null {
  return args.resumeFromPath ?? args.checkpointPath;
}

function readJsonFile<T>(path: string): T {
  const resolvedPath = resolve(process.cwd(), path);
  return JSON.parse(readFileSync(resolvedPath, 'utf8')) as T;
}

function candidateCheckpointKey(candidate: CandidateRow): string {
  const leadKey =
    candidate.leadId ||
    (candidate.smartleadLeadId != null ? `sl:${candidate.smartleadLeadId}` : candidate.leadEmail);
  return [
    leadKey,
    candidate.mailboxId,
    candidate.messageId ?? '',
    candidate.receivedAt,
    candidate.sentMessageId ?? '',
  ].join('|');
}

function loadAuditCheckpoint(
  checkpointPath: string | null,
  campaignId: string,
  selectedMailboxIds: string[],
  args: Args,
): AuditCheckpoint | null {
  if (!checkpointPath) return null;
  if (!existsSync(resolve(process.cwd(), checkpointPath))) return null;
  const checkpoint = readJsonFile<AuditCheckpoint>(checkpointPath);
  if (checkpoint.kind !== 'audit' || checkpoint.version !== 1) {
    throw new Error(`Checkpoint ${checkpointPath} is not an audit checkpoint.`);
  }
  if (checkpoint.campaignId !== campaignId) {
    throw new Error(`Checkpoint ${checkpointPath} belongs to a different campaign.`);
  }
  if (checkpoint.args.since !== args.since.toISOString()) {
    throw new Error(`Checkpoint ${checkpointPath} was created with a different --since value.`);
  }
  if ((checkpoint.args.until ?? null) !== (args.until?.toISOString() ?? null)) {
    throw new Error(`Checkpoint ${checkpointPath} was created with a different --until value.`);
  }
  const currentMailboxIds = [...selectedMailboxIds].sort();
  const checkpointMailboxIds = [...checkpoint.selectedMailboxIds].sort();
  if (JSON.stringify(currentMailboxIds) !== JSON.stringify(checkpointMailboxIds)) {
    throw new Error(`Checkpoint ${checkpointPath} mailbox selection does not match the current run.`);
  }
  return checkpoint;
}

function persistAuditCheckpoint(checkpointPath: string | null, checkpoint: AuditCheckpoint): void {
  if (!checkpointPath) return;
  writeJson(checkpointPath, checkpoint);
}

function loadImportCheckpoint(
  checkpointPath: string | null,
  campaignId: string,
  inputPath: string,
  minConfidence: number,
): ImportCheckpoint | null {
  if (!checkpointPath) return null;
  if (!existsSync(resolve(process.cwd(), checkpointPath))) return null;
  const checkpoint = readJsonFile<ImportCheckpoint>(checkpointPath);
  if (checkpoint.kind !== 'import' || checkpoint.version !== 1) {
    throw new Error(`Checkpoint ${checkpointPath} is not an import checkpoint.`);
  }
  if (checkpoint.campaignId !== campaignId) {
    throw new Error(`Checkpoint ${checkpointPath} belongs to a different campaign.`);
  }
  if (checkpoint.inputPath !== inputPath) {
    throw new Error(`Checkpoint ${checkpointPath} was created from a different input file.`);
  }
  if (checkpoint.minConfidence !== minConfidence) {
    throw new Error(`Checkpoint ${checkpointPath} was created with a different --min-confidence value.`);
  }
  return checkpoint;
}

function persistImportCheckpoint(checkpointPath: string | null, checkpoint: ImportCheckpoint): void {
  if (!checkpointPath) return;
  writeJson(checkpointPath, checkpoint);
}

function selectSentLead(
  recipientEmails: string[],
  leadMap: Map<string, LeadRecord>,
): LeadRecord | null {
  for (const recipient of recipientEmails) {
    const lead = leadMap.get(recipient);
    if (lead) return lead;
  }
  return null;
}

function shouldTagSentMessage(
  lead: LeadRecord,
  subjectMatch: boolean,
  bodyMatch: boolean,
): boolean {
  if (lead.overlapCount <= 1) return true;
  return subjectMatch || bodyMatch;
}

function dedupeCandidates(rows: CandidateRow[]): CandidateRow[] {
  const seen = new Set<string>();
  const deduped: CandidateRow[] = [];
  for (const row of rows.sort((a, b) => b.confidence - a.confidence || a.receivedAt.localeCompare(b.receivedAt))) {
    const key = `${row.leadId || row.smartleadLeadId || row.leadEmail}:${row.messageId ?? row.mailboxId + ':' + row.receivedAt + ':' + row.subject}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(row);
  }
  return deduped.sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
}

async function buildAuditOutput(
  supabase: SupabaseClient,
  campaign: CampaignRow,
  args: Args,
): Promise<AuditOutput> {
  const { leadMap, recipients } = await resolveRecipientLeadMap(supabase, campaign, args.smartleadApiKey);
  const { mailboxes, senders } = await resolveAuditMailboxes(supabase, campaign, args);
  const { copy, warnings } = await resolveCopyConfig(campaign, args);
  const smartleadSentContext =
    args.smartleadApiKey && campaign.smartlead_campaign_id
      ? await fetchFootTrafficSentContext(args.smartleadApiKey, campaign, args.since, args.until)
      : {
          thisCampaignSent: null,
          companionCampaignSent: null,
          combinedSent: null,
          companionCampaignName: FOOT_TRAFFIC_RECOVERY_PAIRS[campaign.id]?.companionName ?? null,
        };
  if (smartleadSentContext.thisCampaignSent != null) {
    const companionPart =
      smartleadSentContext.companionCampaignSent != null && smartleadSentContext.companionCampaignName
        ? `, ${smartleadSentContext.companionCampaignName} ${smartleadSentContext.companionCampaignSent}`
        : '';
    const combinedPart =
      smartleadSentContext.combinedSent != null
        ? `, combined ${smartleadSentContext.combinedSent} (operator combined expectation: ${OPERATOR_EXPECTED_COMBINED_SENT})`
        : '';
    console.log(
      `Smartlead sends since ${args.since.toISOString().slice(0, 10)}: this campaign ${smartleadSentContext.thisCampaignSent}${companionPart}${combinedPart}. Recovery ratio uses this campaign only (${smartleadSentContext.thisCampaignSent}).`,
    );
  }
  const checkpointPath = resolveCheckpointPath(args);
  const checkpoint = loadAuditCheckpoint(
    checkpointPath,
    campaign.id,
    mailboxes.map((mailbox) => mailbox.id),
    args,
  );

  const generatedAt = checkpoint?.generatedAt ?? new Date().toISOString();
  const sentFolderUsage: AuditOutput['sentFolderUsage'] = [...(checkpoint?.sentFolderUsage ?? [])];
  const errors = [...(checkpoint?.errors ?? []), ...warnings, ...recipients.warnings, ...senders.warnings];
  const candidateRows: CandidateRow[] = [...(checkpoint?.candidates ?? [])];
  const reviewRows: CandidateRow[] = [...(checkpoint?.review ?? [])];
  const diagnostics = cloneAuditDiagnostics(checkpoint?.diagnostics, copy, warnings);
  diagnostics.recipients = recipients;
  diagnostics.senders = senders;
  console.log(
    `Senders: ${diagnostics.senders.source} | assigned=${diagnostics.senders.smartleadAssignedCount} intersection=${diagnostics.senders.intersectionCount} selected=${diagnostics.senders.selectedForScan} coverage=${diagnostics.senders.meetsCoverageGuarantee ? 'yes' : 'no'}`,
  );
  let dropped = checkpoint?.dropped ?? 0;
  let sentIndexSize = checkpoint?.sentIndexSize ?? 0;
  const completedMailboxIds = new Set(checkpoint?.completedMailboxIds ?? []);
  const subjectSummaryMap = new Map<string, { sampleSubject: string; count: number }>(
    (checkpoint?.sentSubjectSummary ?? []).map((row) => [
      row.normalizedSubject,
      { sampleSubject: row.sampleSubject, count: row.count },
    ]),
  );
  const remainingMailboxes = mailboxes.filter((mailbox) => !completedMailboxIds.has(mailbox.id));
  const mailboxOrdinalById = new Map(mailboxes.map((mailbox, index) => [mailbox.id, index + 1]));
  let checkpointWriteChain = Promise.resolve();

  const snapshotAuditCheckpoint = (): AuditCheckpoint => ({
    kind: 'audit',
    version: 1,
    generatedAt,
    updatedAt: new Date().toISOString(),
    campaignId: campaign.id,
    selectedMailboxIds: mailboxes.map((mailbox) => mailbox.id),
    args: {
      since: args.since.toISOString(),
      until: args.until?.toISOString() ?? null,
      concurrency: args.concurrency,
      copySource: copy?.source ?? null,
    },
    completedMailboxIds: [...completedMailboxIds],
    sentIndexSize,
    sentSubjectSummary: [...subjectSummaryMap.entries()].map(([normalizedSubject, entry]) => ({
      normalizedSubject,
      sampleSubject: entry.sampleSubject,
      count: entry.count,
    })),
    sentFolderUsage,
    candidates: candidateRows,
    review: reviewRows,
    dropped,
    errors,
    diagnostics,
  });

  await runWithConcurrency(remainingMailboxes, args.concurrency, async (mailbox, index) => {
    const usage = {
      mailboxEmail: mailbox.email_address,
      folderPath: null as string | null,
      outboundTagged: 0,
      scannedSent: 0,
      scannedInbox: 0,
      errors: [] as string[],
    };

    let client: ImapFlow | null = null;
    const taggedSentMessages: SentMessageRecord[] = [];
    const mailboxCandidates: CandidateRow[] = [];
    const mailboxReview: CandidateRow[] = [];
    const mailboxDiagnostics = createMailboxDiagnostics(mailbox.email_address);
    let mailboxDropped = 0;
    try {
      client = await connectMailbox(mailbox, (error) => {
        usage.errors.push(`imap socket: ${error.message}`);
      });
      const sentFolder = await resolveSentFolder(client);
      usage.errors.push(...sentFolder.errors);
      usage.folderPath = sentFolder.selectedPath;
      mailboxDiagnostics.folderPath = sentFolder.selectedPath;

      if (sentFolder.selectedPath) {
        const sentUids = await fetchFolderUids(client, args.since, args.until);
        console.log(
          `[recover-smartlead] Sent scan ${mailboxOrdinalById.get(mailbox.id) ?? index + 1}/${mailboxes.length}: ${mailbox.email_address} (${sentUids.length} messages since ${args.since.toISOString().slice(0, 10)})`,
        );
        usage.scannedSent = sentUids.length;
        mailboxDiagnostics.sent.scannedSent = sentUids.length;
        for (const uid of sentUids) {
          try {
            const parsed = await parseImapMessage(client, uid);
            if (args.until && parsed.date > args.until) continue;
            const lead = selectSentLead(parsed.to, leadMap);
            const normalizedSubject = normalizeSubjectCore(parsed.subject);
            if (!lead) {
              mailboxDiagnostics.sent.noLeadMatch += 1;
              pushLimited(mailboxDiagnostics.skippedSentSamples, {
                uid,
                leadEmail: null,
                overlapCount: null,
                subject: parsed.subject,
                normalizedSubject,
                bodySnippet: bodySnippet(parsed.bodyText, parsed.bodyHtml),
                to: parsed.to,
                messageId: parsed.messageId,
                rawMessageId: parsed.rawMessageId,
                subjectMatched: false,
                bodyMatched: false,
                stepLabel: null,
                reason: 'no campaign lead recipient matched any Sent recipient',
              }, MAX_DIAGNOSTIC_SAMPLES_PER_MAILBOX);
              continue;
            }
            mailboxDiagnostics.sent.toLead += 1;
            const subjectMatch = subjectMatchesCopy(normalizedSubject, copy);
            const bodyMatch = bodyMatchesCopy(parsed.bodyText, parsed.bodyHtml, copy);
            if (subjectMatch.matched) mailboxDiagnostics.sent.copySubjectMatch += 1;
            if (bodyMatch.matched) mailboxDiagnostics.sent.copyBodyMatch += 1;
            if (!shouldTagSentMessage(lead, subjectMatch.matched, bodyMatch.matched)) {
              if (lead.overlapCount > 1 && !subjectMatch.matched && !bodyMatch.matched) {
                mailboxDiagnostics.sent.untaggedOverlapNoCopy += 1;
              }
              pushLimited(mailboxDiagnostics.skippedSentSamples, {
                uid,
                leadEmail: lead.email,
                overlapCount: lead.overlapCount,
                subject: parsed.subject,
                normalizedSubject,
                bodySnippet: bodySnippet(parsed.bodyText, parsed.bodyHtml),
                to: parsed.to,
                messageId: parsed.messageId,
                rawMessageId: parsed.rawMessageId,
                subjectMatched: subjectMatch.matched,
                bodyMatched: bodyMatch.matched,
                stepLabel: subjectMatch.stepLabel ?? bodyMatch.stepLabel,
                reason: lead.overlapCount > 1 ? 'overlapping lead without Smartlead copy match' : 'sent row not tagged by lead gate',
              }, MAX_DIAGNOSTIC_SAMPLES_PER_MAILBOX);
              continue;
            }
            const stepLabel = subjectMatch.stepLabel ?? bodyMatch.stepLabel;
            mailboxDiagnostics.sent.tagged += 1;
            if (!subjectMatch.matched && !bodyMatch.matched && lead.overlapCount <= 1) {
              mailboxDiagnostics.sent.uniqueLeadTaggedWithoutCopy += 1;
            }
            taggedSentMessages.push({
              mailboxId: mailbox.id,
              mailboxEmail: mailbox.email_address,
              sentFolderPath: sentFolder.selectedPath,
              uid,
              messageId: parsed.messageId,
              rawMessageId: parsed.rawMessageId,
              inReplyTo: parsed.inReplyTo,
              messageReferences: parsed.messageReferences,
              sentAt: parsed.date.toISOString(),
              subject: parsed.subject,
              normalizedSubject,
              bodyText: parsed.bodyText,
              bodyHtml: parsed.bodyHtml,
              bodySnippet: bodySnippet(parsed.bodyText, parsed.bodyHtml),
              leadEmail: lead.email,
              leadId: lead.leadId ?? '',
              enrollmentId: lead.enrollmentId,
              smartleadLeadId: lead.smartleadLeadId,
              copyMatched: subjectMatch.matched,
              bodyMatched: bodyMatch.matched,
              stepLabel,
              ambiguousLeadEmail: lead.overlapCount > 1,
            });
          } catch (error) {
            usage.errors.push(`sent uid ${uid}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
        usage.outboundTagged = taggedSentMessages.length;
      }

      await openInboxResilient(client);
      const inboxUids = await fetchFolderUids(client, args.since, args.until);
      console.log(
        `[recover-smartlead] INBOX scan ${mailboxOrdinalById.get(mailbox.id) ?? index + 1}/${mailboxes.length}: ${mailbox.email_address} (${inboxUids.length} messages since ${args.since.toISOString().slice(0, 10)})`,
      );
      usage.scannedInbox = inboxUids.length;
      mailboxDiagnostics.inbox.scannedInbox = inboxUids.length;
      const sentById = new Map<string, SentMessageRecord>();
      for (const sent of taggedSentMessages) {
        if (sent.messageId) sentById.set(sent.messageId, sent);
      }
      for (const uid of inboxUids) {
        try {
          const parsed = await parseImapMessage(client, uid);
          if (args.until && parsed.date > args.until) continue;
          const fromEmail = normalizeEmail(parsed.from);
          if (!fromEmail) continue;
          const lead = leadMap.get(fromEmail);
          if (!lead) continue;
          mailboxDiagnostics.inbox.leadMatches += 1;

          const normalizedSubject = normalizeSubjectCore(parsed.subject);
          const subjectMatch = subjectMatchesCopy(normalizedSubject, copy);
          const bodyMatch = bodyMatchesCopy(parsed.bodyText, parsed.bodyHtml, copy);
          const searchIds = extractSearchIds(parsed.inReplyTo, parsed.messageReferences);
          const sentHits = searchIds
            .map((id) => ({ id, sent: sentById.get(id) ?? null }))
            .filter((value): value is { id: string; sent: SentMessageRecord } => !!value.sent);
          const parentSent = sentHits.map((value) => value.sent).find((value): value is SentMessageRecord => !!value) ?? null;
          const matchingLeadHit = sentHits.find((value) => leadsSameIdentity(value.sent, lead)) ?? null;
          const wrongLeadSearchIds = sentHits
            .filter((value) => !leadsSameIdentity(value.sent, lead))
            .map((value) => value.id);

          let confidence = 0;
          let matchType: CandidateMatchType = 'review';
          let reason = 'lead matched but attribution weak';

          if (parentSent && leadsSameIdentity(parentSent, lead)) {
            confidence = parentSent.ambiguousLeadEmail && !parentSent.copyMatched && !parentSent.bodyMatched ? 70 : 95;
            matchType = confidence >= 90 ? 'thread_anchor' : 'review';
            reason = 'reply references tagged Sent message on same mailbox';
          } else if (lead.overlapCount <= 1 && subjectMatch.matched) {
            confidence = 75;
            matchType = 'subject_lead';
            reason = 'lead sender plus sequence subject match';
          } else if (lead.overlapCount <= 1 && bodyMatch.matched) {
            confidence = 75;
            matchType = 'subject_lead';
            reason = 'lead sender plus sequence body fingerprint match';
          } else if (lead.overlapCount > 1 && (subjectMatch.matched || bodyMatch.matched)) {
            confidence = 60;
            matchType = 'review';
            reason = 'overlapping lead email with copy match needs review';
          } else if (lead.overlapCount <= 1) {
            confidence = 45;
            matchType = 'review';
            reason = 'lead sender without anchored Sent match';
          } else {
            confidence = 30;
            reason = 'overlapping lead email without disambiguation';
          }

          if (searchIds.length === 0) mailboxDiagnostics.inbox.noSearchIds += 1;
          if (searchIds.length > 0 && sentHits.length === 0) mailboxDiagnostics.inbox.searchIdsNoSentHit += 1;
          if (searchIds.length > 0 && sentHits.length > 0 && !matchingLeadHit) mailboxDiagnostics.inbox.searchIdsHitWrongLead += 1;
          if (parentSent && leadsSameIdentity(parentSent, lead)) mailboxDiagnostics.inbox.anchored += 1;
          if (!parentSent && lead.overlapCount <= 1 && subjectMatch.matched) mailboxDiagnostics.inbox.leadOnlySubjectMatch += 1;
          if (!parentSent && lead.overlapCount <= 1 && bodyMatch.matched) mailboxDiagnostics.inbox.leadOnlyBodyMatch += 1;

          const row: CandidateRow = {
            confidence,
            matchType,
            reason,
            leadEmail: lead.email,
            leadId: lead.leadId ?? '',
            enrollmentId: lead.enrollmentId,
            smartleadLeadId: lead.smartleadLeadId,
            mailboxId: mailbox.id,
            mailboxEmail: mailbox.email_address,
            sentFolderPath: parentSent?.sentFolderPath ?? null,
            receivedAt: parsed.date.toISOString(),
            subject: parsed.subject,
            normalizedSubject,
            messageId: parsed.messageId,
            inReplyTo: parsed.inReplyTo,
            references: parsed.messageReferences,
            sentMessageId: parentSent?.messageId ?? null,
            sentAt: parentSent?.sentAt ?? null,
            stepLabel: parentSent?.stepLabel ?? subjectMatch.stepLabel ?? bodyMatch.stepLabel,
            ambiguousLeadEmail: lead.overlapCount > 1,
            bodyFingerprintMatched: bodyMatch.matched || !!parentSent?.bodyMatched,
            receivedMessage: parsedToExportMessage(parsed, 'INBOX', 'received'),
            sentMessages: selectSentMessagesForExport(taggedSentMessages, lead.email, parsed.date.toISOString()),
          };

          if (confidence >= 75 && matchType !== 'review') {
            mailboxCandidates.push(row);
          } else if (confidence >= 40) {
            mailboxReview.push(row);
            mailboxDiagnostics.inbox.review += 1;
            if (!parentSent) {
              pushLimited(mailboxDiagnostics.replyMissSamples, {
                uid,
                leadEmail: lead.email,
                overlapCount: lead.overlapCount,
                subject: parsed.subject,
                normalizedSubject,
                messageId: parsed.messageId,
                inReplyTo: parsed.inReplyTo,
                references: parsed.messageReferences,
                searchIds,
                matchedSearchIds: sentHits.map((value) => value.id),
                wrongLeadSearchIds,
                subjectMatched: subjectMatch.matched,
                bodyMatched: bodyMatch.matched,
                matchedStepLabel: subjectMatch.stepLabel ?? bodyMatch.stepLabel,
                reason,
              }, MAX_DIAGNOSTIC_SAMPLES_PER_MAILBOX);
            }
          } else {
            mailboxDropped += 1;
            mailboxDiagnostics.inbox.dropped += 1;
            if (searchIds.length > 0 || subjectMatch.matched || bodyMatch.matched) {
              pushLimited(mailboxDiagnostics.replyMissSamples, {
                uid,
                leadEmail: lead.email,
                overlapCount: lead.overlapCount,
                subject: parsed.subject,
                normalizedSubject,
                messageId: parsed.messageId,
                inReplyTo: parsed.inReplyTo,
                references: parsed.messageReferences,
                searchIds,
                matchedSearchIds: sentHits.map((value) => value.id),
                wrongLeadSearchIds,
                subjectMatched: subjectMatch.matched,
                bodyMatched: bodyMatch.matched,
                matchedStepLabel: subjectMatch.stepLabel ?? bodyMatch.stepLabel,
                reason,
              }, MAX_DIAGNOSTIC_SAMPLES_PER_MAILBOX);
            }
          }
        } catch (error) {
          usage.errors.push(`inbox uid ${uid}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    } catch (error) {
      const err = error as { message?: string; responseStatus?: string; executedCommand?: string };
      usage.errors.push(
        `${err.message ?? String(error)}${err.responseStatus ? ` [${err.responseStatus}]` : ''}${
          err.executedCommand ? ` (${err.executedCommand})` : ''
        }`,
      );
    } finally {
      if (client) {
        try {
          await client.logout();
        } catch {
          // ignore
        }
      }
    }

    checkpointWriteChain = checkpointWriteChain.then(async () => {
      sentFolderUsage.push(usage);
      completedMailboxIds.add(mailbox.id);
      sentIndexSize += taggedSentMessages.length;
      diagnostics.mailboxes.push(mailboxDiagnostics);
      mailboxDiagnostics.sent.scannedSent = usage.scannedSent;
      mailboxDiagnostics.inbox.scannedInbox = usage.scannedInbox;
      diagnostics.totals.sent.scannedSent += mailboxDiagnostics.sent.scannedSent;
      diagnostics.totals.sent.toLead += mailboxDiagnostics.sent.toLead;
      diagnostics.totals.sent.noLeadMatch += mailboxDiagnostics.sent.noLeadMatch;
      diagnostics.totals.sent.copySubjectMatch += mailboxDiagnostics.sent.copySubjectMatch;
      diagnostics.totals.sent.copyBodyMatch += mailboxDiagnostics.sent.copyBodyMatch;
      diagnostics.totals.sent.tagged += mailboxDiagnostics.sent.tagged;
      diagnostics.totals.sent.untaggedOverlapNoCopy += mailboxDiagnostics.sent.untaggedOverlapNoCopy;
      diagnostics.totals.sent.uniqueLeadTaggedWithoutCopy += mailboxDiagnostics.sent.uniqueLeadTaggedWithoutCopy;
      diagnostics.totals.inbox.scannedInbox += mailboxDiagnostics.inbox.scannedInbox;
      diagnostics.totals.inbox.leadMatches += mailboxDiagnostics.inbox.leadMatches;
      diagnostics.totals.inbox.noSearchIds += mailboxDiagnostics.inbox.noSearchIds;
      diagnostics.totals.inbox.searchIdsNoSentHit += mailboxDiagnostics.inbox.searchIdsNoSentHit;
      diagnostics.totals.inbox.searchIdsHitWrongLead += mailboxDiagnostics.inbox.searchIdsHitWrongLead;
      diagnostics.totals.inbox.anchored += mailboxDiagnostics.inbox.anchored;
      diagnostics.totals.inbox.leadOnlySubjectMatch += mailboxDiagnostics.inbox.leadOnlySubjectMatch;
      diagnostics.totals.inbox.leadOnlyBodyMatch += mailboxDiagnostics.inbox.leadOnlyBodyMatch;
      diagnostics.totals.inbox.review += mailboxDiagnostics.inbox.review;
      diagnostics.totals.inbox.dropped += mailboxDiagnostics.inbox.dropped;
      for (const row of taggedSentMessages) {
        const entry = subjectSummaryMap.get(row.normalizedSubject) ?? {
          sampleSubject: row.subject,
          count: 0,
        };
        entry.count += 1;
        subjectSummaryMap.set(row.normalizedSubject, entry);
      }
      candidateRows.push(...mailboxCandidates);
      reviewRows.push(...mailboxReview);
      dropped += mailboxDropped;
      const mailboxNum = mailboxOrdinalById.get(mailbox.id) ?? index + 1;
      console.log(
        `[recover-smartlead] Done ${mailboxNum}/${mailboxes.length}: ${mailbox.email_address} — taggedSent=${taggedSentMessages.length} +${mailboxCandidates.length} candidates +${mailboxReview.length} review (totals: ${candidateRows.length} candidates, ${reviewRows.length} review)`,
      );
      if (usage.errors.some((value) => value.includes('inbox uid') || value.includes('SELECT INBOX'))) {
        errors.push(`${usage.mailboxEmail}: ${usage.errors.join('; ')}`);
      }
      persistAuditCheckpoint(checkpointPath, snapshotAuditCheckpoint());
    });
    await checkpointWriteChain;
  });

  const sentSubjectSummary = [...subjectSummaryMap.entries()]
    .map(([normalizedSubject, entry]) => ({
      normalizedSubject,
      sampleSubject: entry.sampleSubject,
      count: entry.count,
    }))
    .sort((a, b) => b.count - a.count || a.normalizedSubject.localeCompare(b.normalizedSubject))
    .slice(0, 50);
  persistAuditCheckpoint(checkpointPath, snapshotAuditCheckpoint());

  diagnostics.campaignSentExpectation = finalizeCampaignSentExpectation(
    args.since,
    campaign.id,
    senders,
    diagnostics.totals,
    smartleadSentContext,
  );
  errors.push(...diagnostics.campaignSentExpectation.warnings);
  console.log(
    `Campaign Sent recovery: tagged=${diagnostics.campaignSentExpectation.imapTaggedSent} expected=${diagnostics.campaignSentExpectation.expectedTaggedSent} ratio=${diagnostics.campaignSentExpectation.recoveryRatio != null ? `${Math.round(diagnostics.campaignSentExpectation.recoveryRatio * 100)}%` : 'n/a'}${diagnostics.campaignSentExpectation.projectedTaggedSent != null ? ` projected=${diagnostics.campaignSentExpectation.projectedTaggedSent}` : ''}`,
  );

  return {
    generatedAt,
    campaignId: campaign.id,
    campaignName: campaign.name,
    accountId: campaign.account_id,
    copySource: copy?.source ?? null,
    scannedMailboxes: mailboxes.length,
    sentIndexSize,
    sentSubjectSummary,
    sentFolderUsage,
    candidates: dedupeCandidates(candidateRows),
    review: dedupeCandidates(reviewRows),
    dropped,
    errors,
    diagnostics,
  };
}

function requireApply(): void {
  if (process.env.APPLY !== 'true') {
    throw new Error('Import mode requires APPLY=true.');
  }
}

async function fetchExistingThreadId(
  supabase: SupabaseClient,
  campaignId: string,
  smartleadLeadId: number | null,
): Promise<string | null> {
  if (smartleadLeadId == null) return null;
  const { data, error } = await supabase
    .from('email_threads')
    .select('id')
    .eq('campaign_id', campaignId)
    .eq('smartlead_lead_id', smartleadLeadId)
    .maybeSingle();
  if (error) throw new Error(`Failed to check existing thread: ${error.message}`);
  return data?.id ?? null;
}

async function fetchExistingMessageIds(
  supabase: SupabaseClient,
  accountId: string,
  messageIds: string[],
): Promise<Set<string>> {
  const normalized = [...new Set(messageIds.filter(Boolean))];
  if (normalized.length === 0) return new Set<string>();
  const { data, error } = await supabase
    .from('email_messages')
    .select('message_id')
    .eq('account_id', accountId)
    .in('message_id', normalized);
  if (error) throw new Error(`Failed to check existing message ids: ${error.message}`);
  return new Set(
    (data ?? [])
      .map((row) => normalizeMessageId((row as { message_id: string | null }).message_id))
      .filter((value): value is string => !!value),
  );
}

type ThreadFetchProgress = (message: string) => void;

async function fetchThreadMessagesForImport(
  mailbox: MailboxRow,
  since: Date,
  until: Date | null,
  leadEmail: string,
  receivedAt: string,
  sentMessageId: string | null,
  targetMessageId: string | null = null,
  onProgress?: ThreadFetchProgress,
): Promise<{ sentMessages: ReturnType<typeof parseImapMessage>[]; receivedMessage: Awaited<ReturnType<typeof parseImapMessage>> | null; sentFolderPath: string | null }> {
  let client: ImapFlow | null = null;
  const receivedAtMs = new Date(receivedAt).getTime();
  const normalizedTargetMessageId = targetMessageId ? normalizeMessageId(targetMessageId) : null;
  const log = (message: string): void => {
    onProgress?.(message);
  };
  try {
    log(`connecting to ${mailbox.email_address}…`);
    client = await connectMailbox(mailbox);
    const sentFolder = await resolveSentFolder(client);
    const sentMessages: Array<Awaited<ReturnType<typeof parseImapMessage>>> = [];

    if (sentFolder.selectedPath) {
      const sentUids = await fetchFolderUids(client, since, until);
      log(`Sent folder "${sentFolder.selectedPath}": scanning ${sentUids.length} messages…`);
      for (const uid of sentUids) {
        const parsed = await parseImapMessage(client, uid);
        if (until && parsed.date > until) continue;
        if (!parsed.to.includes(leadEmail)) continue;
        if (new Date(parsed.date).getTime() > receivedAtMs) continue;
        sentMessages.push(parsed);
      }
      log(`Sent folder: ${sentMessages.length} message(s) to ${leadEmail} before reply`);
    }

    await openInboxResilient(client);
    const inboxUids = await fetchFolderUids(client, since, until);
    log(`INBOX: scanning ${inboxUids.length} messages for ${leadEmail}…`);
    let receivedMessage: Awaited<ReturnType<typeof parseImapMessage>> | null = null;
    for (const uid of inboxUids) {
      const parsed = await parseImapMessage(client, uid);
      if (until && parsed.date > until) continue;
      if (normalizeEmail(parsed.from) !== leadEmail) continue;
      const parsedMessageId = normalizeMessageId(parsed.messageId);
      if (normalizedTargetMessageId && parsedMessageId === normalizedTargetMessageId) {
        receivedMessage = parsed;
        break;
      }
      if (Math.abs(new Date(parsed.date).getTime() - receivedAtMs) > 86_400_000) continue;
      if (sentMessageId && normalizeMessageId(parsed.inReplyTo) === sentMessageId) {
        receivedMessage = parsed;
        break;
      }
      if (!receivedMessage) {
        receivedMessage = parsed;
      }
    }

    const sortedSent = sentMessages.sort((a, b) => a.date.getTime() - b.date.getTime());
    if (receivedMessage) {
      const hasBody = Boolean(receivedMessage.bodyText?.trim() || receivedMessage.bodyHtml?.trim());
      log(`INBOX: found reply (body=${hasBody ? 'yes' : 'no'})`);
    } else {
      log('INBOX: no matching reply found');
    }
    return { sentMessages: sortedSent, receivedMessage, sentFolderPath: sentFolder.selectedPath };
  } finally {
    if (client) {
      try {
        await client.logout();
      } catch {
        // ignore
      }
    }
  }
}

async function materializeRecoveryExport(
  supabase: SupabaseClient,
  campaign: CampaignRow,
  args: Args,
  audit: AuditOutput,
): Promise<RecoveryExportPackage> {
  const mailboxes = await fetchAccountMailboxes(supabase, campaign.account_id, null);
  const mailboxById = new Map(mailboxes.map((mailbox) => [mailbox.id, mailbox]));

  const existingByKey = new Map<string, RecoveryThreadExport>();
  if (args.exportOutputPath && existsSync(args.exportOutputPath)) {
    try {
      const existing = readJsonFile<RecoveryExportPackage>(args.exportOutputPath);
      for (const thread of existing.threads ?? []) {
        existingByKey.set(`${thread.leadEmail}|${thread.threadDraft.lastMessageAt}`, thread);
      }
      console.log(`[materialize] loaded ${existingByKey.size} threads from existing export`);
    } catch {
      // ignore corrupt prior export
    }
  }

  const allRows = [...dedupeCandidates(audit.candidates), ...dedupeCandidates(audit.review)];
  const rowsNeedingFetch = allRows.filter((row) => {
    const existingKey = `${row.leadEmail}|${row.receivedAt}`;
    const existingThread = existingByKey.get(existingKey);
    if (existingThread?.receivedMessage && hasMessageBody(existingThread.receivedMessage)) return false;
    if (row.receivedMessage && hasMessageBody(row.receivedMessage)) return false;
    return true;
  });
  console.log(
    `[materialize] plan: ${allRows.length} threads total, ${allRows.length - rowsNeedingFetch.length} already have bodies, ${rowsNeedingFetch.length} to fetch from IMAP`,
  );
  if (rowsNeedingFetch.length > 0) {
    console.log(`[materialize] missing bodies: ${rowsNeedingFetch.map((row) => row.leadEmail).join(', ')}`);
  }

  const fetchIndexByLead = new Map(
    rowsNeedingFetch.map((row, index) => [row.leadEmail, index + 1] as const),
  );
  const enrichRow = async (row: CandidateRow): Promise<CandidateRow> => {
    const existingKey = `${row.leadEmail}|${row.receivedAt}`;
    const existingThread = existingByKey.get(existingKey);
    if (existingThread?.receivedMessage && hasMessageBody(existingThread.receivedMessage)) {
      return {
        ...row,
        receivedMessage: existingThread.receivedMessage,
        sentMessages: existingThread.sentMessages,
      };
    }
    if (row.receivedMessage && hasMessageBody(row.receivedMessage)) {
      return row;
    }
    const mailbox = mailboxById.get(row.mailboxId);
    if (!mailbox) {
      console.warn(`[materialize] mailbox not found for ${row.leadEmail}`);
      return row;
    }
    const fetchIndex = fetchIndexByLead.get(row.leadEmail);
    const fetchTotal = rowsNeedingFetch.length;
    if (fetchIndex == null) {
      return row;
    }
    console.log(
      `[materialize] [${fetchIndex}/${fetchTotal}] ${row.leadEmail} via ${mailbox.email_address}`,
    );
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (attempt > 1) {
        console.log(`[materialize] [${fetchIndex}/${fetchTotal}] retry ${attempt}/${maxAttempts} for ${row.leadEmail}`);
      }
      try {
        const thread = await fetchThreadMessagesForImport(
          mailbox,
          args.since,
          args.until,
          row.leadEmail,
          row.receivedAt,
          row.sentMessageId,
          row.messageId,
          (message) => console.log(`[materialize] [${fetchIndex}/${fetchTotal}] ${row.leadEmail}: ${message}`),
        );
        const sentFolderPath = thread.sentFolderPath ?? row.sentFolderPath ?? 'Sent Items';
        const enriched: CandidateRow = {
          ...row,
          receivedMessage: thread.receivedMessage
            ? parsedToExportMessage(thread.receivedMessage, 'INBOX', 'received')
            : row.receivedMessage ?? null,
          sentMessages: thread.sentMessages.map((message) =>
            parsedToExportMessage(message, sentFolderPath, 'sent'),
          ),
        };
        const gotBody = hasMessageBody(enriched.receivedMessage);
        console.log(
          `[materialize] [${fetchIndex}/${fetchTotal}] done ${row.leadEmail} — ${gotBody ? 'body captured' : 'WARNING: no body'}`,
        );
        return enriched;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (attempt >= maxAttempts) {
          console.warn(`[materialize] [${fetchIndex}/${fetchTotal}] FAILED ${row.leadEmail}: ${message}`);
          return row;
        }
        console.warn(`[materialize] [${fetchIndex}/${fetchTotal}] attempt ${attempt}/${maxAttempts} failed: ${message}`);
        await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
      }
    }
    return row;
  };

  const materializeConcurrency = Math.min(args.concurrency, 3);
  const enrichedRows = await runWithConcurrency(allRows, materializeConcurrency, enrichRow);
  const candidateCount = dedupeCandidates(audit.candidates).length;
  const candidates = enrichedRows.slice(0, candidateCount);
  const review = enrichedRows.slice(candidateCount);
  const enrichedAudit: AuditOutput = { ...audit, candidates, review };
  const gate = evaluateAuditGate(audit);
  return buildRecoveryExportPackage(enrichedAudit, campaign, args, gate);
}

function logExportSummary(exportPkg: RecoveryExportPackage, exportPath: string): void {
  writeJson(exportPath, exportPkg);
  console.log(`Recovery export written to ${resolve(process.cwd(), exportPath)}`);
  console.log(`Export threads: ${exportPkg.threads.length}`);
  const readiness = exportPkg.threads.reduce<Record<ImportReadiness, number>>(
    (acc, thread) => {
      acc[thread.importReadiness] = (acc[thread.importReadiness] ?? 0) + 1;
      return acc;
    },
    { ready: 0, needs_lead_mapping: 0, needs_review: 0 },
  );
  console.log(
    `Import readiness: ready=${readiness.ready} needs_lead_mapping=${readiness.needs_lead_mapping} needs_review=${readiness.needs_review}`,
  );
  const missingBodies = exportPkg.threads.filter((thread) => !hasMessageBody(thread.receivedMessage)).length;
  if (missingBodies > 0) {
    console.log(`Warning: ${missingBodies} threads missing received message body`);
  }
}

async function importAuditOutput(
  supabase: SupabaseClient,
  campaign: CampaignRow,
  args: Args,
): Promise<ImportSummary> {
  requireApply();
  if (!args.inputPath) throw new Error('Import mode requires --input.');
  const raw = JSON.parse(readFileSync(args.inputPath, 'utf8')) as AuditOutput;
  const checkpointPath = resolveCheckpointPath(args);
  const importCheckpoint = loadImportCheckpoint(
    checkpointPath,
    campaign.id,
    args.inputPath,
    args.minConfidence,
  );
  const mailboxes = await fetchAccountMailboxes(supabase, campaign.account_id, null);
  const mailboxById = new Map(mailboxes.map((mailbox) => [mailbox.id, mailbox]));

  const approved = raw.candidates.filter((candidate) => candidate.confidence >= args.minConfidence);
  const processedCandidateKeys = new Set(importCheckpoint?.processedCandidateKeys ?? []);
  const summary: ImportSummary = importCheckpoint?.summary ?? {
    generatedAt: new Date().toISOString(),
    campaignId: campaign.id,
    createdThreads: 0,
    skippedExistingThreads: 0,
    skippedExistingMessages: 0,
    insertedMessages: 0,
    importedLeadEmails: [],
    skipped: [],
  };

  const persistCurrentImportCheckpoint = (): void => {
    if (!checkpointPath || !args.inputPath) return;
    persistImportCheckpoint(checkpointPath, {
      kind: 'import',
      version: 1,
      generatedAt: importCheckpoint?.generatedAt ?? summary.generatedAt,
      updatedAt: new Date().toISOString(),
      campaignId: campaign.id,
      inputPath: args.inputPath,
      minConfidence: args.minConfidence,
      processedCandidateKeys: [...processedCandidateKeys],
      summary,
    });
  };

  for (const candidate of approved) {
    const candidateKey = candidateCheckpointKey(candidate);
    if (processedCandidateKeys.has(candidateKey)) {
      continue;
    }
    const mailbox = mailboxById.get(candidate.mailboxId);
    if (!mailbox) {
      summary.skipped.push({ leadEmail: candidate.leadEmail, reason: `mailbox ${candidate.mailboxId} not found` });
      processedCandidateKeys.add(candidateKey);
      persistCurrentImportCheckpoint();
      continue;
    }

    if (!isImportableLeadId(candidate.leadId)) {
      summary.skipped.push({
        leadEmail: candidate.leadEmail,
        reason: 'no Furnace lead_id mapping (Smartlead-only recipient; audit-only)',
      });
      processedCandidateKeys.add(candidateKey);
      persistCurrentImportCheckpoint();
      continue;
    }

    const existingThreadId = await fetchExistingThreadId(supabase, campaign.id, candidate.smartleadLeadId);
    if (existingThreadId) {
      summary.skippedExistingThreads += 1;
      summary.skipped.push({ leadEmail: candidate.leadEmail, reason: 'thread already exists for campaign + smartlead_lead_id' });
      processedCandidateKeys.add(candidateKey);
      persistCurrentImportCheckpoint();
      continue;
    }

    const threadMessages = await fetchThreadMessagesForImport(
      mailbox,
      args.since,
      args.until,
      candidate.leadEmail,
      candidate.receivedAt,
      candidate.sentMessageId,
    );
    if (!threadMessages.receivedMessage) {
      summary.skipped.push({ leadEmail: candidate.leadEmail, reason: 'could not re-fetch inbound reply message for import' });
      processedCandidateKeys.add(candidateKey);
      persistCurrentImportCheckpoint();
      continue;
    }

    const allMessageIds = [
      ...threadMessages.sentMessages.map((message) => message.messageId),
      threadMessages.receivedMessage.messageId,
    ].filter((value): value is string => !!value);
    const existingMessageIds = await fetchExistingMessageIds(supabase, campaign.account_id, allMessageIds);
    if (threadMessages.receivedMessage.messageId && existingMessageIds.has(threadMessages.receivedMessage.messageId)) {
      summary.skippedExistingMessages += 1;
      summary.skipped.push({ leadEmail: candidate.leadEmail, reason: 'received message_id already exists in email_messages' });
      processedCandidateKeys.add(candidateKey);
      persistCurrentImportCheckpoint();
      continue;
    }

    const participants = Array.from(
      new Set(
        [
          mailbox.email_address,
          candidate.leadEmail,
          ...threadMessages.sentMessages.flatMap((message) => message.to),
          normalizeEmail(threadMessages.receivedMessage.from) ?? '',
        ].filter(Boolean),
      ),
    );

    const lastMessageAt = threadMessages.receivedMessage.date.toISOString();
    const subject = threadMessages.sentMessages[0]?.subject ?? candidate.subject;
    const { data: insertedThread, error: threadError } = await (supabase
      .from('email_threads')
      .insert({
        account_id: campaign.account_id,
        campaign_id: campaign.id,
        lead_id: candidate.leadId,
        enrollment_id: candidate.enrollmentId,
        message_job_id: null,
        mailbox_id: mailbox.id,
        smartlead_lead_id: candidate.smartleadLeadId,
        subject,
        participants,
        last_message_at: lastMessageAt,
        message_count: threadMessages.sentMessages.length + 1,
        has_reply: true,
      } as any)
      .select('id')
      .single() as any);
    if (threadError || !insertedThread?.id) {
      throw new Error(`Failed to insert recovered thread for ${candidate.leadEmail}: ${threadError?.message ?? 'missing thread id'}`);
    }
    summary.createdThreads += 1;

    const threadId = insertedThread.id as string;
    const rows: Array<Record<string, unknown>> = [];
    for (const message of threadMessages.sentMessages) {
      if (message.messageId && existingMessageIds.has(message.messageId)) continue;
      rows.push({
        thread_id: threadId,
        account_id: campaign.account_id,
        message_job_id: null,
        direction: 'sent',
        from_email: mailbox.email_address,
        from_name: mailbox.display_name,
        to_email: candidate.leadEmail,
        to_name: null,
        subject: message.subject,
        body_text: message.bodyText,
        body_html: message.bodyHtml,
        message_id: message.messageId,
        in_reply_to: message.inReplyTo,
        message_references: message.messageReferences,
        received_at: message.date.toISOString(),
        headers: {
          source: 'imap_recovery',
          folder: threadMessages.sentFolderPath,
          uid: message.uid,
        },
        attachments: [],
      });
    }

    rows.push({
      thread_id: threadId,
      account_id: campaign.account_id,
      message_job_id: null,
      direction: 'received',
      from_email: candidate.leadEmail,
      from_name: null,
      to_email: mailbox.email_address,
      to_name: mailbox.display_name,
      subject: threadMessages.receivedMessage.subject,
      body_text: threadMessages.receivedMessage.bodyText,
      body_html: threadMessages.receivedMessage.bodyHtml,
      message_id: threadMessages.receivedMessage.messageId,
      in_reply_to: threadMessages.receivedMessage.inReplyTo,
      message_references: threadMessages.receivedMessage.messageReferences,
      received_at: threadMessages.receivedMessage.date.toISOString(),
      headers: {
        source: 'imap_recovery',
        folder: 'INBOX',
        uid: threadMessages.receivedMessage.uid,
      },
      attachments: [],
      imap_uid: threadMessages.receivedMessage.uid,
    });

    if (rows.length > 0) {
      const { error: messageError } = await (supabase.from('email_messages').insert(rows as any) as any);
      if (messageError) {
        throw new Error(`Failed to insert recovered messages for ${candidate.leadEmail}: ${messageError.message}`);
      }
      summary.insertedMessages += rows.length;
    }

    summary.importedLeadEmails.push(candidate.leadEmail);
    processedCandidateKeys.add(candidateKey);
    persistCurrentImportCheckpoint();
  }

  const { data: currentStats, error: statsError } = await supabase
    .from('campaign_stats')
    .select('sent_count, replied_count, positive_reply_count, bounce_count, last_bounce_at')
    .eq('campaign_id', campaign.id)
    .maybeSingle();
  if (statsError) throw new Error(`Failed to load campaign_stats for reconciliation: ${statsError.message}`);

  const currentSmartleadStats: SmartleadCampaignStats | null = currentStats
    ? {
      sent: currentStats.sent_count ?? 0,
      replied: currentStats.replied_count ?? 0,
      positiveReply: currentStats.positive_reply_count ?? 0,
      bounce: currentStats.bounce_count ?? 0,
      lastBounceAt: currentStats.last_bounce_at ?? null,
    }
    : null;
  await finalizeImportedCampaignStats(campaign.id, campaign.account_id, currentSmartleadStats, supabase as any);
  summary.generatedAt = summary.generatedAt || new Date().toISOString();
  summary.campaignId = campaign.id;
  persistCurrentImportCheckpoint();
  return summary;
}

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index]!, index);
    }
  });
  await Promise.all(runners);
  return results;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.campaignId) throw new Error('Missing --campaign-id.');
  const checkpointPath = resolveCheckpointPath(args);

  const { targetEnv, urlSource, secretSource, supabase } = await createSupabase();
  console.log(`Target env: ${targetEnv}`);
  console.log(`Supabase URL from ${urlSource}`);
  console.log(`Supabase secret from ${secretSource}`);
  console.log(`Mode: ${args.mode}`);
  console.log(`Campaign: ${args.campaignId}`);
  console.log(`Since: ${args.since.toISOString()}`);
  if (args.until) {
    console.log(`Until: ${args.until.toISOString()}`);
  } else {
    console.log('Message window: all Sent/INBOX mail since --since (no per-mailbox cap)');
  }
  if (checkpointPath) console.log(`Checkpoint: ${resolve(process.cwd(), checkpointPath)}`);
  if (args.mailboxEmails?.length) console.log(`Mailbox filter: ${args.mailboxEmails.join(', ')}`);
  if (args.mailboxStart != null || args.mailboxCount != null) {
    console.log(`Mailbox slice: start=${args.mailboxStart ?? 0} count=${args.mailboxCount ?? 'all'}`);
  }

  const campaign = await fetchCampaign(supabase, args.campaignId);
  console.log(`Campaign name: ${campaign.name}`);
  console.log(`Smartlead campaign id: ${campaign.smartlead_campaign_id ?? 'none'}`);

  if (args.mode === 'spike') {
    const spikeResults = await runSentFolderSpike(supabase, campaign, args);
    if (args.outputPath) writeJson(args.outputPath, spikeResults);
    for (const result of spikeResults) {
      console.log(
        [
          result.mailboxEmail,
          `sentFolder=${result.sentFolderPath ?? 'none'}`,
          `taggedSent=${result.sentMessagesScanned}`,
          `messageIds=${result.sampleMessageIds.slice(0, 3).join('|') || 'none'}`,
          result.errors.length ? `errors=${result.errors.length}` : '',
        ].filter(Boolean).join(' | '),
      );
    }
    return;
  }

  if (args.mode === 'audit') {
    const audit = await buildAuditOutput(supabase, campaign, args);
    const gate = evaluateAuditGate(audit);
    if (args.outputPath) {
      writeJson(args.outputPath, audit);
      console.log(`Audit output written to ${resolve(process.cwd(), args.outputPath)}`);
    } else {
      console.log(JSON.stringify(audit, null, 2));
    }
    console.log(`Candidates: ${audit.candidates.length}`);
    console.log(`Review: ${audit.review.length}`);
    console.log(`Dropped: ${audit.dropped}`);
    console.log(
      `Recipients: ${audit.diagnostics.recipients.source} | smartleadLeads=${audit.diagnostics.recipients.smartleadLeadCount} furnaceMapped=${audit.diagnostics.recipients.furnaceMappedCount} unmapped=${audit.diagnostics.recipients.unmappedSmartleadCount}`,
    );
    console.log(
      `Senders: ${audit.diagnostics.senders.source} | assigned=${audit.diagnostics.senders.smartleadAssignedCount} intersection=${audit.diagnostics.senders.intersectionCount} selected=${audit.diagnostics.senders.selectedForScan} coverage=${audit.diagnostics.senders.meetsCoverageGuarantee ? 'yes' : 'no'}`,
    );
    console.log(
      `Sent funnel: toLead=${audit.diagnostics.totals.sent.toLead} noLeadMatch=${audit.diagnostics.totals.sent.noLeadMatch} tagged=${audit.diagnostics.totals.sent.tagged}`,
    );
    if (audit.errors.length) {
      console.log(`Warnings/errors: ${audit.errors.length}`);
    }
    console.log(`Gate: ${gate.status}`);
    for (const reason of gate.reasons) {
      console.log(`Gate reason: ${reason}`);
    }
    if (args.exportOutputPath) {
      const exportPkg = buildRecoveryExportPackage(audit, campaign, args, gate);
      logExportSummary(exportPkg, args.exportOutputPath);
    }
    return;
  }

  if (args.mode === 'materialize-export') {
    if (!args.inputPath) throw new Error('materialize-export requires --input (audit JSON).');
    if (!args.exportOutputPath) throw new Error('materialize-export requires --export-output.');
    const audit = readJsonFile<AuditOutput>(args.inputPath);
    console.log(
      `Materializing export from ${resolve(process.cwd(), args.inputPath)} (${audit.candidates.length} candidates, ${audit.review.length} review)`,
    );
    const exportPkg = await materializeRecoveryExport(supabase, campaign, args, audit);
    logExportSummary(exportPkg, args.exportOutputPath);
    return;
  }

  const summary = await importAuditOutput(supabase, campaign, args);
  if (args.outputPath) {
    writeJson(args.outputPath, summary);
    console.log(`Import summary written to ${resolve(process.cwd(), args.outputPath)}`);
  } else {
    console.log(JSON.stringify(summary, null, 2));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
