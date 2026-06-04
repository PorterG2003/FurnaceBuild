import assert from 'node:assert/strict';
import test from 'node:test';
import { matchesAccountManagementLifecycleFilter } from './accountManagementFilters';

test('matchesAccountManagementLifecycleFilter excludes revoked and expired from default all filter', () => {
  assert.equal(matchesAccountManagementLifecycleFilter('draft', 'all'), true);
  assert.equal(matchesAccountManagementLifecycleFilter('sent', 'all'), true);
  assert.equal(matchesAccountManagementLifecycleFilter('active', 'all'), true);
  assert.equal(matchesAccountManagementLifecycleFilter('revoked', 'all'), false);
  assert.equal(matchesAccountManagementLifecycleFilter('expired', 'all'), false);
});

test('matchesAccountManagementLifecycleFilter shows archived rows with explicit filters', () => {
  assert.equal(matchesAccountManagementLifecycleFilter('revoked', 'revoked'), true);
  assert.equal(matchesAccountManagementLifecycleFilter('expired', 'expired'), true);
  assert.equal(matchesAccountManagementLifecycleFilter('draft', 'revoked'), false);
  assert.equal(matchesAccountManagementLifecycleFilter('sent', 'expired'), false);
});

test('matchesAccountManagementLifecycleFilter keeps other lifecycle filters exact', () => {
  assert.equal(matchesAccountManagementLifecycleFilter('draft', 'draft'), true);
  assert.equal(matchesAccountManagementLifecycleFilter('sent', 'draft'), false);
  assert.equal(matchesAccountManagementLifecycleFilter('pending_payment', 'pending_payment'), true);
  assert.equal(matchesAccountManagementLifecycleFilter('active', 'active'), true);
});
