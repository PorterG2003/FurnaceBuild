export {
  applyMailboxImapFailureUpdate,
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

export { default as connectionErrors } from './connectionErrors.js';
export { default as imapInbox } from './imapInbox.js';
