/** Minimal ImapFlow surface for attaching error guards without an imapflow dependency. */
export type ImapFlowErrorEmitter = {
  on(event: 'error', listener: (error: Error) => void): unknown;
  off(event: 'error', listener: (error: Error) => void): unknown;
};

export type ImapFlowErrorGuard = {
  /** Throws and clears the most recent async socket/protocol error, if any. */
  throwIfError: () => void;
  /** Removes the error listener. Safe to call multiple times. */
  dispose: () => void;
};

/**
 * ImapFlow emits socket timeout and TLS errors on its `error` event. Without a listener,
 * Node treats those as uncaught and the inbox-checker process exits.
 */
export function createImapFlowErrorGuard(client: ImapFlowErrorEmitter): ImapFlowErrorGuard {
  let pending: Error | null = null;
  const onError = (err: Error) => {
    pending = err instanceof Error ? err : new Error(String(err));
  };

  client.on('error', onError);

  return {
    throwIfError() {
      if (!pending) {
        return;
      }
      const err = pending;
      pending = null;
      throw err;
    },
    dispose() {
      client.off('error', onError);
    },
  };
}
