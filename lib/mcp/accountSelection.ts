const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type AccountSelectionSuccess = {
  ok: true;
  accountId: string;
  /** Tool args with `account_id` removed (never forward to Client API path/body). */
  forwardedArgs: Record<string, unknown>;
};

export type AccountSelectionFailure = {
  ok: false;
  message: string;
};

export type AccountSelectionResult = AccountSelectionSuccess | AccountSelectionFailure;

export type ResolveAccountSelectionInput = {
  args: Record<string, unknown>;
  allowedAccountIds: string[];
};

/**
 * Resolve which account a tool call should target.
 * - 1 granted account → default when omitted
 * - multiple + omitted → actionable error listing options
 * - ungranted / malformed → error
 * Always strips `account_id` from forwarded args.
 */
export function resolveAccountSelection(
  input: ResolveAccountSelectionInput,
): AccountSelectionResult {
  const { args, allowedAccountIds } = input;
  const forwardedArgs = { ...args };
  const raw = forwardedArgs.account_id;
  delete forwardedArgs.account_id;

  const granted = [...new Set(allowedAccountIds.filter(Boolean))];

  if (granted.length === 0) {
    return {
      ok: false,
      message:
        'No accounts are granted on this MCP session. Reconnect and select at least one workspace.',
    };
  }

  if (raw === undefined || raw === null || raw === '') {
    if (granted.length === 1) {
      return { ok: true, accountId: granted[0]!, forwardedArgs };
    }
    return {
      ok: false,
      message:
        `account_id is required when multiple workspaces are granted. ` +
        `Pass one of: ${granted.join(', ')}. Call listAccounts to see names and roles.`,
    };
  }

  if (typeof raw !== 'string') {
    return { ok: false, message: 'account_id must be a string UUID.' };
  }

  const accountId = raw.trim();
  if (!UUID_RE.test(accountId)) {
    return { ok: false, message: 'account_id must be a valid UUID.' };
  }

  if (!granted.includes(accountId)) {
    return {
      ok: false,
      message:
        `account_id ${accountId} is not in this session's grant. ` +
        `Granted: ${granted.join(', ')}. Call listAccounts or reconnect to grant more workspaces.`,
    };
  }

  return { ok: true, accountId, forwardedArgs };
}

/** Inject optional account_id into a generated tool's JSON Schema. */
export function injectAccountIdIntoInputSchema(
  inputSchema: Record<string, unknown>,
): Record<string, unknown> {
  const schema = { ...inputSchema };
  const properties =
    schema.properties && typeof schema.properties === 'object'
      ? { ...(schema.properties as Record<string, unknown>) }
      : {};
  if (!('account_id' in properties)) {
    properties.account_id = {
      type: 'string',
      format: 'uuid',
      description:
        'Furnace workspace (account) id to act on. Required when the MCP session grants more than one account. Call listAccounts first.',
    };
  }
  schema.properties = properties;
  return schema;
}
