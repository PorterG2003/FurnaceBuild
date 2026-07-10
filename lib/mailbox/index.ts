export {
  applyMailboxImapFailureUpdate,
  applyMailboxImapSuccessUpdate,
  applyMailboxSmtpFailureUpdate,
  classifyImapError,
  classifySmtpError,
  formatImapError,
  type ConnectionFailureKind,
  type ImapErrorDetails,
} from './connectionErrors.js';

export {
  isExchangeLsubError,
  openImapInbox,
  verifyImapInboxAccess,
  type ImapClientLike,
} from './imapInbox.js';

export {
  IMAP_CONNECTION_TIMEOUT_MS,
  IMAP_GREETING_TIMEOUT_MS,
  IMAP_SOCKET_TIMEOUT_MS,
  buildImapFlowOptions,
  type ImapConnectionConfig,
} from './imapClientOptions.js';

export {
  createImapFlowErrorGuard,
  type ImapFlowErrorEmitter,
  type ImapFlowErrorGuard,
} from './imapFlowGuard.js';

export {
  inferImapInfraFailureCode,
  isSystemicInfraFailure,
  type ImapRecoveryFailure,
} from './imapRecoveryAlert.js';

export { default as connectionErrors } from './connectionErrors.js';
export { default as imapInbox } from './imapInbox.js';
