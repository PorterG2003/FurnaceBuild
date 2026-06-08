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
export declare function formatImapError(error: unknown, details?: ImapErrorDetails): {
    error: string;
    details?: ImapErrorDetails;
};
export declare function classifyImapError(error: unknown): {
    kind: ConnectionFailureKind;
    message: string;
};
export declare function classifySmtpError(error: unknown): {
    kind: ConnectionFailureKind;
    message: string;
    responseCode?: number;
};
export declare function applyMailboxImapFailureUpdate(kind: ConnectionFailureKind, message: string): {
    error_message: string;
    imap_claimed_at: null;
    status?: 'error';
};
export declare function applyMailboxSmtpFailureUpdate(kind: ConnectionFailureKind, message: string): {
    error_message: string;
    smtp_status: 'error';
} | null;
declare const _default: {
    formatImapError: typeof formatImapError;
    classifyImapError: typeof classifyImapError;
    classifySmtpError: typeof classifySmtpError;
    applyMailboxImapFailureUpdate: typeof applyMailboxImapFailureUpdate;
    applyMailboxSmtpFailureUpdate: typeof applyMailboxSmtpFailureUpdate;
};
export default _default;
//# sourceMappingURL=connectionErrors.d.ts.map