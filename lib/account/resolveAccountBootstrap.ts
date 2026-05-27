export interface AccountBootstrapState {
  accountId: string | null;
  isAccountBootstrapping: boolean;
  accountBootstrapError: string | null;
}

export function resolveAccountBootstrap(params: {
  loading: boolean;
  accountId: string | null | undefined;
  contextError: string | null;
}): AccountBootstrapState {
  const { loading, accountId, contextError } = params;

  if (loading) {
    return {
      accountId: null,
      isAccountBootstrapping: true,
      accountBootstrapError: null,
    };
  }

  if (contextError) {
    return {
      accountId: null,
      isAccountBootstrapping: false,
      accountBootstrapError: contextError,
    };
  }

  if (!accountId) {
    return {
      accountId: null,
      isAccountBootstrapping: false,
      accountBootstrapError: 'No active account found.',
    };
  }

  return {
    accountId,
    isAccountBootstrapping: false,
    accountBootstrapError: null,
  };
}
