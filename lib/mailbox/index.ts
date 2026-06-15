export {
  applyMailboxImapFailureUpdate,
  applyMailboxSmtpFailureUpdate,
  classifyImapError,
  classifySmtpError,
  formatImapError,
  type ConnectionFailureKind,
  type ImapErrorDetails,
} from './connectionErrors';

export {
  isExchangeLsubError,
  openImapInbox,
  verifyImapInboxAccess,
  type ImapClientLike,
} from './imapInbox';

export { default as connectionErrors } from './connectionErrors';
export { default as imapInbox } from './imapInbox';
