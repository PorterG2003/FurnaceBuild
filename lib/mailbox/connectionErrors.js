"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatImapError = formatImapError;
exports.classifyImapError = classifyImapError;
exports.classifySmtpError = classifySmtpError;
exports.applyMailboxImapFailureUpdate = applyMailboxImapFailureUpdate;
exports.applyMailboxSmtpFailureUpdate = applyMailboxSmtpFailureUpdate;
const TRANSIENT_NETWORK_CODES = new Set([
    'ECONNECTION',
    'ECONNREFUSED',
    'ENETUNREACH',
    'EHOSTUNREACH',
    'ETIMEDOUT',
]);
const PERMANENT_AUTH_PATTERNS = [
    /account disabled/i,
    /auth(?:entication)?/i,
    /credential/i,
    /invalid (?:login|password|credentials|username)/i,
    /login/i,
    /mailbox unavailable/i,
];
function coerceString(value) {
    if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim();
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        return String(value);
    }
    return undefined;
}
function getImapResponseText(err) {
    return coerceString(err.response)
        ?? coerceString(err.serverResponse?.text)
        ?? (typeof err.responseText === 'string'
            ? coerceString(err.responseText)
            : err.responseText != null && typeof err.responseText === 'object'
                ? JSON.stringify(err.responseText)
                : undefined);
}
function buildFormattedImapError(err, baseDetails) {
    const details = baseDetails ? { ...baseDetails } : undefined;
    const responseStatus = coerceString(err.responseStatus) ?? coerceString(err.serverResponse?.status);
    const responseText = getImapResponseText(err);
    const executedCommand = coerceString(err.executedCommand);
    const code = coerceString(err.code);
    if (details) {
        if (responseStatus)
            details.responseStatus = responseStatus;
        if (responseText)
            details.responseText = responseText;
        if (executedCommand)
            details.executedCommand = executedCommand;
        if (code)
            details.code = code;
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
function getSmtpResponseCode(err) {
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
function formatImapError(error, details) {
    return buildFormattedImapError(error, details);
}
function classifyImapError(error) {
    const err = error;
    const formatted = buildFormattedImapError(err);
    const message = formatted.error;
    const responseStatus = coerceString(err.responseStatus) ?? coerceString(err.serverResponse?.status);
    const code = coerceString(err.code);
    const responseText = getImapResponseText(err) ?? '';
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
    if (PERMANENT_AUTH_PATTERNS.some((pattern) => pattern.test(combinedText))) {
        return { kind: 'permanent', message };
    }
    return { kind: 'unknown', message };
}
function classifySmtpError(error) {
    const err = error;
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
function applyMailboxImapFailureUpdate(kind, message) {
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
function applyMailboxSmtpFailureUpdate(kind, message) {
    if (kind !== 'permanent') {
        return null;
    }
    return {
        smtp_status: 'error',
        error_message: message,
    };
}
exports.default = {
    formatImapError,
    classifyImapError,
    classifySmtpError,
    applyMailboxImapFailureUpdate,
    applyMailboxSmtpFailureUpdate,
};
//# sourceMappingURL=connectionErrors.js.map