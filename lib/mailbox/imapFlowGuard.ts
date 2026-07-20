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
 *
 * A socket timeout can fire *after* the operation completes and `dispose()` runs — e.g. on a
 * lingering socket during or after `logout()`, since ImapFlow's `socketTimeout` keeps ticking
 * until the connection is fully torn down. To keep that late event from crashing the process,
 * we attach a second, permanent safety listener that `dispose()` never removes, so the client
 * always has at least one `error` listener for its entire lifetime. `dispose()` only removes the
 * capturing listener used by `throwIfError()`.
 */
export function createImapFlowErrorGuard(client: ImapFlowErrorEmitter): ImapFlowErrorGuard {
  let pending: Error | null = null;
  const onError = (err: Error) => {
    pending = err instanceof Error ? err : new Error(String(err));
  };

  // Permanent safety net: absorbs teardown-time socket/TLS errors that arrive after dispose().
  // Errors during an active operation are still surfaced synchronously via throwIfError().
  const onErrorSafety = () => {};

  client.on('error', onError);
  client.on('error', onErrorSafety);

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
