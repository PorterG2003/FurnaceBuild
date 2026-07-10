import { isExchangeLsubError } from './imapInbox.js';

export type ConnectionFailureKind = 'permanent' | 'transient' | 'unknown';

export interface ImapErrorDetails {
  stage: 'connect' | 'mailboxOpen' | 'unknown';
  host: string;
  port: number;
  secure: boolean;
  sameHostAsSmtp: boolean;
  samePortAsSmtp: boolean;
  responseStatus?: string;
  responseText?: string;
  executedCommand?: string;
  code?: string;
  serverName?: string;
}

type ImapErrorLike = {
  message?: string;
  response?: string;
  responseText?: string;
  responseStatus?: string;
  executedCommand?: string;
  code?: string;
  serverResponse?: { status?: string; text?: string };
};

type SmtpErrorLike = {
  message?: string;
  code?: string;
  response?: string | number;
  responseCode?: number;
};

const TRANSIENT_NETWORK_CODES = new Set([
  'ECONNECTION',
  'ECONNREFUSED',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'ETIMEDOUT',
  'ETIMEOUT',
]);

const TRANSIENT_TLS_PATTERNS = [
  /decryption failed or bad record mac/i,
  /ssl routines:/i,
  /socket timeout/i,
];

const PERMANENT_AUTH_PATTERNS = [
  /account disabled/i,
  /auth(?:entication)?/i,
  /credential/i,
  /invalid (?:login|password|credentials|username)/i,
  /login/i,
  /mailbox unavailable/i,
];

function coerceString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  return undefined;
}

function getImapResponseText(err: ImapErrorLike): string | undefined {
  return coerceString(err.response)
    ?? coerceString(err.serverResponse?.text)
    ?? (typeof err.responseText === 'string'
      ? coerceString(err.responseText)
      : err.responseText != null && typeof err.responseText === 'object'
        ? JSON.stringify(err.responseText)
        : undefined);
}

function buildFormattedImapError(
  err: ImapErrorLike,
  baseDetails?: ImapErrorDetails,
): { error: string; details?: ImapErrorDetails } {
  const details = baseDetails ? { ...baseDetails } : undefined;

  const responseStatus = coerceString(err.responseStatus) ?? coerceString(err.serverResponse?.status);
  const responseText = getImapResponseText(err);
  const executedCommand = coerceString(err.executedCommand);
  const code = coerceString(err.code);

  if (details) {
    if (responseStatus) details.responseStatus = responseStatus;
    if (responseText) details.responseText = responseText;
    if (executedCommand) details.executedCommand = executedCommand;
    if (code) details.code = code;
  }

  const parts = [coerceString(err.message) ?? 'IMAP connection failed'];
  if (responseStatus || responseText) {
    parts.push([responseStatus, responseText].filter(Boolean).join(' ').trim());
  }
  if (executedCommand) {
    parts.push(`cmd=${executedCommand}`);
  }

  return {
    error: parts.filter(Boolean).join(' — '),
    details,
  };
}

function getSmtpResponseCode(err: SmtpErrorLike): number | undefined {
  if (typeof err.responseCode === 'number' && Number.isFinite(err.responseCode)) {
    return err.responseCode;
  }

  const response = err.response;
  if (typeof response === 'number' && Number.isFinite(response)) {
    return response;
  }

  if (typeof response === 'string') {
    const match = response.match(/\b([245]\d{2})\b/);
    if (match) {
      return Number.parseInt(match[1], 10);
    }
  }

  const message = coerceString(err.message);
  if (message) {
    const match = message.match(/\b([245]\d{2})\b/);
    if (match) {
      return Number.parseInt(match[1], 10);
    }
  }

  return undefined;
}

export function formatImapError(
  error: unknown,
  details?: ImapErrorDetails,
): { error: string; details?: ImapErrorDetails } {
  return buildFormattedImapError(error as ImapErrorLike, details);
}

export function classifyImapError(
  error: unknown,
): { kind: ConnectionFailureKind; message: string } {
  const err = error as ImapErrorLike;
  const formatted = buildFormattedImapError(err);
  const message = formatted.error;
  const responseStatus = coerceString(err.responseStatus) ?? coerceString(err.serverResponse?.status);
  const code = coerceString(err.code);
  const responseText = getImapResponseText(err) ?? '';

  if (isExchangeLsubError(error)) {
    return { kind: 'transient', message };
  }

  if (responseStatus === 'NO' || responseStatus === 'BAD') {
    return { kind: 'permanent', message };
  }

  if (code === 'ENOTFOUND' || /getaddrinfo ENOTFOUND/i.test(message)) {
    return { kind: 'permanent', message };
  }

  if (code && TRANSIENT_NETWORK_CODES.has(code)) {
    return { kind: 'transient', message };
  }

  const combinedText = `${message} ${responseText}`.trim();
  if (TRANSIENT_TLS_PATTERNS.some((pattern) => pattern.test(combinedText))) {
    return { kind: 'transient', message };
  }

  if (PERMANENT_AUTH_PATTERNS.some((pattern) => pattern.test(combinedText))) {
    return { kind: 'permanent', message };
  }

  return { kind: 'unknown', message };
}

export function classifySmtpError(
  error: unknown,
): { kind: ConnectionFailureKind; message: string; responseCode?: number } {
  const err = error as SmtpErrorLike;
  const message = coerceString(err.message) ?? 'SMTP connection failed';
  const code = coerceString(err.code);
  const responseCode = getSmtpResponseCode(err);

  if (code === 'EAUTH') {
    return { kind: 'permanent', message, responseCode };
  }

  if (responseCode !== undefined) {
    if (responseCode >= 500) {
      return { kind: 'permanent', message, responseCode };
    }

    if (responseCode >= 400) {
      return { kind: 'transient', message, responseCode };
    }
  }

  if (code && TRANSIENT_NETWORK_CODES.has(code)) {
    return { kind: 'transient', message, responseCode };
  }

  if (PERMANENT_AUTH_PATTERNS.some((pattern) => pattern.test(message))) {
    return { kind: 'permanent', message, responseCode };
  }

  return { kind: 'unknown', message, responseCode };
}

export function applyMailboxImapSuccessUpdate(
  syncedAt: string = new Date().toISOString(),
): { last_synced_at: string; imap_claimed_at: null; error_message: null } {
  return {
    last_synced_at: syncedAt,
    imap_claimed_at: null,
    error_message: null,
  };
}

export function applyMailboxImapFailureUpdate(
  kind: ConnectionFailureKind,
  message: string,
): { error_message: string; imap_claimed_at: null; status?: 'error' } {
  if (kind === 'permanent') {
    return {
      status: 'error',
      error_message: message,
      imap_claimed_at: null,
    };
  }

  return {
    error_message: message,
    imap_claimed_at: null,
  };
}

export function applyMailboxSmtpFailureUpdate(
  kind: ConnectionFailureKind,
  message: string,
): { error_message: string; smtp_status: 'error' } | null {
  if (kind !== 'permanent') {
    return null;
  }

  return {
    smtp_status: 'error',
    error_message: message,
  };
}

export default {
  formatImapError,
  classifyImapError,
  classifySmtpError,
  applyMailboxImapSuccessUpdate,
  applyMailboxImapFailureUpdate,
  applyMailboxSmtpFailureUpdate,
};
