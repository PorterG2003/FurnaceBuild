/** Minimal ImapFlow surface used by mailbox connect helpers (avoids imapflow dep in lib). */
export type ImapClientLike = {
  status(path: string, query: { messages?: boolean }): Promise<unknown>;
  mailboxOpen(path: string): Promise<unknown>;
  run(
    command: string,
    reference: string,
    mailbox: string,
    options?: { listOnly?: boolean },
  ): Promise<unknown>;
  folders: Map<string, Record<string, unknown>>;
};

function asImapClient(client: unknown): ImapClientLike {
  return client as ImapClientLike;
}

/** Exchange / InboxAlways proxies often reject LSUB with BAD "Command Argument Error". */
export function isExchangeLsubError(error: unknown): boolean {
  const err = error as { executedCommand?: string; responseStatus?: string };
  return (
    err.responseStatus === 'BAD' &&
    typeof err.executedCommand === 'string' &&
    err.executedCommand.toUpperCase().includes('LSUB')
  );
}

async function seedInboxFolderCache(client: ImapClientLike): Promise<void> {
  const folders = (await client.run('LIST', '', 'INBOX', { listOnly: true })) as
    | Array<{ path: string }>
    | null;

  if (Array.isArray(folders)) {
    for (const folder of folders) {
      client.folders.set(folder.path, folder as Record<string, unknown>);
    }
  }

  if (!client.folders.has('INBOX')) {
    client.folders.set('INBOX', {
      path: 'INBOX',
      listed: true,
      subscribed: true,
      flags: new Set<string>(),
      delimiter: '/',
    });
  }
}

/** Verify IMAP auth without LIST+LSUB (STATUS works in AUTHENTICATED state). */
export async function verifyImapInboxAccess(client: unknown): Promise<void> {
  await asImapClient(client).status('INBOX', { messages: true });
}

/** Open INBOX for search/fetch; retries after seeding folder cache when LSUB fails. */
export async function openImapInbox(client: unknown): Promise<void> {
  const imap = asImapClient(client);
  try {
    await imap.mailboxOpen('INBOX');
  } catch (error) {
    if (!isExchangeLsubError(error)) {
      throw error;
    }
    await seedInboxFolderCache(imap);
    await imap.mailboxOpen('INBOX');
  }
}

export default {
  isExchangeLsubError,
  verifyImapInboxAccess,
  openImapInbox,
};
