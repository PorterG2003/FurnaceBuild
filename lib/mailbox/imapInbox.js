"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isExchangeLsubError = isExchangeLsubError;
exports.verifyImapInboxAccess = verifyImapInboxAccess;
exports.openImapInbox = openImapInbox;
function asImapClient(client) {
    return client;
}
/** Exchange / InboxAlways proxies often reject LSUB with BAD "Command Argument Error". */
function isExchangeLsubError(error) {
    const err = error;
    return (err.responseStatus === 'BAD' &&
        typeof err.executedCommand === 'string' &&
        err.executedCommand.toUpperCase().includes('LSUB'));
}
async function seedInboxFolderCache(client) {
    const folders = (await client.run('LIST', '', 'INBOX', { listOnly: true }));
    if (Array.isArray(folders)) {
        for (const folder of folders) {
            client.folders.set(folder.path, folder);
        }
    }
    if (!client.folders.has('INBOX')) {
        client.folders.set('INBOX', {
            path: 'INBOX',
            listed: true,
            subscribed: true,
            flags: new Set(),
            delimiter: '/',
        });
    }
}
/** Verify IMAP auth without LIST+LSUB (STATUS works in AUTHENTICATED state). */
async function verifyImapInboxAccess(client) {
    await asImapClient(client).status('INBOX', { messages: true });
}
/** Open INBOX for search/fetch; retries after seeding folder cache when LSUB fails. */
async function openImapInbox(client) {
    const imap = asImapClient(client);
    try {
        await imap.mailboxOpen('INBOX');
    }
    catch (error) {
        if (!isExchangeLsubError(error)) {
            throw error;
        }
        await seedInboxFolderCache(imap);
        await imap.mailboxOpen('INBOX');
    }
}
exports.default = {
    isExchangeLsubError,
    verifyImapInboxAccess,
    openImapInbox,
};
//# sourceMappingURL=imapInbox.js.map