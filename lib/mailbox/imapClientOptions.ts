export const IMAP_CONNECTION_TIMEOUT_MS = 15_000;
export const IMAP_GREETING_TIMEOUT_MS = 10_000;
export const IMAP_SOCKET_TIMEOUT_MS = 45_000;

export interface ImapConnectionConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  useSSL: boolean;
}

export function buildImapFlowOptions(config: ImapConnectionConfig) {
  return {
    host: config.host,
    port: config.port,
    secure: config.useSSL,
    auth: {
      user: config.username,
      pass: config.password,
    },
    logger: false as const,
    connectionTimeout: IMAP_CONNECTION_TIMEOUT_MS,
    greetingTimeout: IMAP_GREETING_TIMEOUT_MS,
    socketTimeout: IMAP_SOCKET_TIMEOUT_MS,
  };
}
