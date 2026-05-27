import assert from 'node:assert';
import { describe, it } from 'node:test';
import { resolveAccountBootstrap } from './resolveAccountBootstrap';

describe('resolveAccountBootstrap', () => {
  it('returns bootstrapping state while account context is loading', () => {
    assert.deepStrictEqual(
      resolveAccountBootstrap({
        loading: true,
        accountId: null,
        contextError: null,
      }),
      {
        accountId: null,
        isAccountBootstrapping: true,
        accountBootstrapError: null,
      },
    );
  });

  it('does not report an error while account context is still loading', () => {
    assert.deepStrictEqual(
      resolveAccountBootstrap({
        loading: true,
        accountId: 'acct-1',
        contextError: 'Should be ignored during bootstrap',
      }),
      {
        accountId: null,
        isAccountBootstrapping: true,
        accountBootstrapError: null,
      },
    );
  });

  it('returns account id after bootstrap completes', () => {
    assert.deepStrictEqual(
      resolveAccountBootstrap({
        loading: false,
        accountId: 'acct-1',
        contextError: null,
      }),
      {
        accountId: 'acct-1',
        isAccountBootstrapping: false,
        accountBootstrapError: null,
      },
    );
  });

  it('returns context error after bootstrap fails', () => {
    assert.deepStrictEqual(
      resolveAccountBootstrap({
        loading: false,
        accountId: null,
        contextError: 'User profile not found.',
      }),
      {
        accountId: null,
        isAccountBootstrapping: false,
        accountBootstrapError: 'User profile not found.',
      },
    );
  });

  it('returns no-account error when bootstrap completes without an account', () => {
    assert.deepStrictEqual(
      resolveAccountBootstrap({
        loading: false,
        accountId: null,
        contextError: null,
      }),
      {
        accountId: null,
        isAccountBootstrapping: false,
        accountBootstrapError: 'No active account found.',
      },
    );
  });
});
