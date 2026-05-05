import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  canManageAccountTeam,
  getAccountMembershipRole,
} from './teamManagementPermissions';

describe('getAccountMembershipRole', () => {
  it('returns the explicit membership role when present', () => {
    assert.strictEqual(
      getAccountMembershipRole({ role: 'owner', is_owner: true } as const),
      'owner'
    );
    assert.strictEqual(
      getAccountMembershipRole({ role: 'admin', is_owner: false } as const),
      'admin'
    );
    assert.strictEqual(
      getAccountMembershipRole({ role: 'member', is_owner: false } as const),
      'member'
    );
  });

  it('falls back to owner when legacy is_owner is true and role is missing', () => {
    assert.strictEqual(getAccountMembershipRole({ role: null, is_owner: true }), 'owner');
  });

  it('falls back to member when no role metadata is available', () => {
    assert.strictEqual(getAccountMembershipRole({ role: null, is_owner: false }), 'member');
    assert.strictEqual(getAccountMembershipRole(null), 'member');
  });
});

describe('canManageAccountTeam', () => {
  it('allows owners and admins to manage the team', () => {
    assert.strictEqual(canManageAccountTeam({ role: 'owner', is_owner: true } as const), true);
    assert.strictEqual(canManageAccountTeam({ role: 'admin', is_owner: false } as const), true);
  });

  it('does not allow members to manage the team', () => {
    assert.strictEqual(canManageAccountTeam({ role: 'member', is_owner: false } as const), false);
    assert.strictEqual(canManageAccountTeam({ role: null, is_owner: false }), false);
  });
});
