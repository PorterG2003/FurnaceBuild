type QueryParamValue = string | string[] | undefined;

export type PublicFlowKind = 'team_invite' | 'platform_invite' | 'account_amendment';
export type PublicAccessIssue = 'resource_unavailable' | 'resource_completed' | 'wrong_email' | 'not_owner';
export type PublicAccessSurface = 'auth' | 'signed_in';

export interface PublicAccessState {
  flow: PublicFlowKind;
  issue: PublicAccessIssue;
  resourceId?: string;
  inviteeEmail?: string | null;
  accountName?: string | null;
  switchAccountId?: string | null;
}

export type PublicAccessAction =
  | { kind: 'none' }
  | { kind: 'navigate'; href: string }
  | { kind: 'sign_out_and_navigate'; href: string };

export interface PublicAccessDialogModel {
  title: string;
  message: string;
  wide?: boolean;
  primaryLabel: string;
  primaryAction: PublicAccessAction;
  secondaryLabel?: string;
  secondaryAction?: PublicAccessAction;
  closeAction?: PublicAccessAction;
}

const ACCESS_FLOW_PARAM = 'access_flow';
const ACCESS_ISSUE_PARAM = 'access_issue';
const ACCESS_RESOURCE_ID_PARAM = 'access_resource_id';
const ACCESS_EMAIL_PARAM = 'access_email';
const ACCESS_ACCOUNT_NAME_PARAM = 'access_account_name';
const ACCESS_SWITCH_ACCOUNT_PARAM = 'access_switch_account';

function readFirstParam(value: QueryParamValue): string | null {
  if (Array.isArray(value)) {
    return typeof value[0] === 'string' && value[0].length > 0 ? value[0] : null;
  }
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function setQueryParam(
  searchParams: URLSearchParams,
  key: string,
  value: string | null | undefined,
) {
  if (value == null || value.length === 0) return;
  searchParams.set(key, value);
}

function buildHref(pathname: string, params: Record<string, string | null | undefined> = {}): string {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    setQueryParam(searchParams, key, value);
  });
  const query = searchParams.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export function buildPublicAccessParams(
  state: PublicAccessState,
): Record<string, string | null | undefined> {
  return {
    [ACCESS_FLOW_PARAM]: state.flow,
    [ACCESS_ISSUE_PARAM]: state.issue,
    [ACCESS_RESOURCE_ID_PARAM]: state.resourceId ?? null,
    [ACCESS_EMAIL_PARAM]: state.inviteeEmail ?? null,
    [ACCESS_ACCOUNT_NAME_PARAM]: state.accountName ?? null,
    [ACCESS_SWITCH_ACCOUNT_PARAM]: state.switchAccountId ?? null,
  };
}

export function stripPublicAccessParams(
  params: Record<string, QueryParamValue>,
): Record<string, string> {
  const nextParams: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(params)) {
    if (
      key === ACCESS_FLOW_PARAM ||
      key === ACCESS_ISSUE_PARAM ||
      key === ACCESS_RESOURCE_ID_PARAM ||
      key === ACCESS_EMAIL_PARAM ||
      key === ACCESS_ACCOUNT_NAME_PARAM ||
      key === ACCESS_SWITCH_ACCOUNT_PARAM
    ) {
      continue;
    }
    const value = readFirstParam(rawValue);
    if (value) {
      nextParams[key] = value;
    }
  }
  return nextParams;
}

function parseLegacyAccessState(
  issue: string,
  params: Record<string, QueryParamValue>,
): PublicAccessState | null {
  if (issue === 'platform_invite_unavailable') {
    return {
      flow: 'platform_invite',
      issue: 'resource_unavailable',
      resourceId: readFirstParam(params.invitation_id) ?? undefined,
    };
  }
  if (issue === 'platform_invite_already_accepted') {
    return {
      flow: 'platform_invite',
      issue: 'resource_completed',
      resourceId: readFirstParam(params.invitation_id) ?? undefined,
    };
  }
  return null;
}

export function parsePublicAccessState(
  params: Record<string, QueryParamValue>,
): PublicAccessState | null {
  const issue = readFirstParam(params[ACCESS_ISSUE_PARAM]);
  if (!issue) return null;

  const flow = readFirstParam(params[ACCESS_FLOW_PARAM]);
  if (!flow) {
    return parseLegacyAccessState(issue, params);
  }

  if (
    flow !== 'team_invite' &&
    flow !== 'platform_invite' &&
    flow !== 'account_amendment'
  ) {
    return null;
  }
  if (
    issue !== 'resource_unavailable' &&
    issue !== 'resource_completed' &&
    issue !== 'wrong_email' &&
    issue !== 'not_owner'
  ) {
    return null;
  }

  return {
    flow,
    issue,
    resourceId: readFirstParam(params[ACCESS_RESOURCE_ID_PARAM]) ?? undefined,
    inviteeEmail: readFirstParam(params[ACCESS_EMAIL_PARAM]),
    accountName: readFirstParam(params[ACCESS_ACCOUNT_NAME_PARAM]),
    switchAccountId: readFirstParam(params[ACCESS_SWITCH_ACCOUNT_PARAM]),
  };
}

function getSignedInDestination(state: PublicAccessState): string {
  if (state.flow === 'team_invite' && (state.issue === 'wrong_email' || state.issue === 'resource_completed')) {
    return buildHref('/account', {
      switch_account: state.switchAccountId ?? null,
    });
  }
  return '/';
}

function getSignedOutDestination(state: PublicAccessState): string {
  if (state.flow === 'team_invite') {
    return buildHref('/auth', {
      invitation_id: state.resourceId ?? null,
      email: state.inviteeEmail ?? null,
    });
  }
  if (state.flow === 'account_amendment') {
    return buildHref('/auth', {
      amendment_id: state.resourceId ?? null,
    });
  }
  return '/auth';
}

export function buildPublicAccessRedirectHref(args: {
  isSignedIn: boolean;
  state: PublicAccessState;
}): string {
  const baseHref = args.isSignedIn
    ? getSignedInDestination(args.state)
    : getSignedOutDestination(args.state);
  const url = new URL(baseHref, 'https://build.getfurnace.io');
  Object.entries(buildPublicAccessParams(args.state)).forEach(([key, value]) => {
    setQueryParam(url.searchParams, key, value);
  });
  const query = url.searchParams.toString();
  return query ? `${url.pathname}?${query}` : url.pathname;
}

function buildSignOutContinuationHref(state: PublicAccessState): string {
  if (state.flow === 'team_invite') {
    return buildHref('/auth', {
      invitation_id: state.resourceId ?? null,
      email: state.inviteeEmail ?? null,
    });
  }
  if (state.flow === 'account_amendment') {
    return buildHref('/auth', {
      amendment_id: state.resourceId ?? null,
    });
  }
  if (state.flow === 'platform_invite' && state.resourceId) {
    return `/accept-platform-invite/${state.resourceId}`;
  }
  return '/auth';
}

function getWrongEmailMessage(
  state: PublicAccessState,
  currentUserEmail: string | null | undefined,
): string {
  const inviteEmail = state.inviteeEmail ?? 'another email';
  const activeEmail = currentUserEmail ?? 'a different account';
  if (state.flow === 'platform_invite') {
    return `This invite is for ${inviteEmail}, but you are signed in as ${activeEmail}. Sign out and continue with the invited email to keep going.`;
  }
  return `This invitation was sent to ${inviteEmail}, but you are signed in as ${activeEmail}. Sign out and continue with the invited email to keep going.`;
}

function getDialogCopy(
  state: PublicAccessState,
  currentUserEmail: string | null | undefined,
): Pick<PublicAccessDialogModel, 'title' | 'message'> {
  switch (state.flow) {
    case 'team_invite':
      switch (state.issue) {
        case 'resource_unavailable':
          return {
            title: 'Invitation unavailable',
            message: 'This invitation is invalid, expired, or no longer active. Ask a workspace admin to send a new invite if you still need access.',
          };
        case 'resource_completed':
          return {
            title: 'Invitation already accepted',
            message: 'This invitation was already used. Open your workspace to continue.',
          };
        case 'wrong_email':
          return {
            title: 'Wrong account signed in',
            message: getWrongEmailMessage(state, currentUserEmail),
            wide: true,
          };
        case 'not_owner':
          return {
            title: 'Access issue',
            message: 'This link requires a different account to continue.',
          };
      }
      break;
    case 'platform_invite':
      switch (state.issue) {
        case 'resource_unavailable':
          return {
            title: 'Invitation unavailable',
            message: 'This invite is no longer available. Look in your email for an active invite, or book a call if you are new to Furnace.',
          };
        case 'resource_completed':
          return {
            title: 'Invitation already accepted',
            message: 'This invitation was already accepted. Open your workspace to continue.',
          };
        case 'wrong_email':
          return {
            title: 'Wrong account signed in',
            message: getWrongEmailMessage(state, currentUserEmail),
            wide: true,
          };
        case 'not_owner':
          return {
            title: 'Access issue',
            message: 'This link requires a different account to continue.',
          };
      }
      break;
    case 'account_amendment':
      switch (state.issue) {
        case 'resource_unavailable':
          return {
            title: 'Agreement update unavailable',
            message: 'This agreement update is no longer waiting for acceptance.',
          };
        case 'not_owner':
          return {
            title: 'Only the account owner can continue',
            message: 'Sign in with the owner account to review and accept this agreement update.',
          };
        case 'resource_completed':
          return {
            title: 'Agreement update already accepted',
            message: 'This agreement update is no longer waiting for acceptance.',
          };
        case 'wrong_email':
          return {
            title: 'Wrong account signed in',
            message: getWrongEmailMessage(state, currentUserEmail),
            wide: true,
          };
      }
      break;
  }

  return {
    title: 'Access issue',
    message: 'We could not continue with this link.',
  };
}

export function resolvePublicAccessDialog(args: {
  state: PublicAccessState;
  surface: PublicAccessSurface;
  currentUserEmail?: string | null;
}): PublicAccessDialogModel {
  const copy = getDialogCopy(args.state, args.currentUserEmail);

  if (args.surface === 'signed_in' && (args.state.issue === 'wrong_email' || args.state.issue === 'not_owner')) {
    const continueHref = buildSignOutContinuationHref(args.state);
    return {
      ...copy,
      primaryLabel: 'Signout',
      primaryAction: { kind: 'sign_out_and_navigate', href: continueHref },
      secondaryLabel: 'Stay',
      secondaryAction: { kind: 'none' },
      closeAction: { kind: 'none' },
    };
  }

  return {
    ...copy,
    primaryLabel: args.surface === 'auth' ? 'Signin' : 'Continue',
    primaryAction: { kind: 'none' },
    closeAction: { kind: 'none' },
  };
}

