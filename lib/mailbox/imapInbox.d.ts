/** Minimal ImapFlow surface used by mailbox connect helpers (avoids imapflow dep in lib). */
export type ImapClientLike = {
    status(path: string, query: {
        messages?: boolean;
    }): Promise<unknown>;
    mailboxOpen(path: string): Promise<unknown>;
    run(command: string, reference: string, mailbox: string, options?: {
        listOnly?: boolean;
    }): Promise<unknown>;
    folders: Map<string, Record<string, unknown>>;
};
/** Exchange / InboxAlways proxies often reject LSUB with BAD "Command Argument Error". */
export declare function isExchangeLsubError(error: unknown): boolean;
/** Verify IMAP auth without LIST+LSUB (STATUS works in AUTHENTICATED state). */
export declare function verifyImapInboxAccess(client: unknown): Promise<void>;
/** Open INBOX for search/fetch; retries after seeding folder cache when LSUB fails. */
export declare function openImapInbox(client: unknown): Promise<void>;
declare const _default: {
    isExchangeLsubError: typeof isExchangeLsubError;
    verifyImapInboxAccess: typeof verifyImapInboxAccess;
    openImapInbox: typeof openImapInbox;
};
export default _default;
//# sourceMappingURL=imapInbox.d.ts.map