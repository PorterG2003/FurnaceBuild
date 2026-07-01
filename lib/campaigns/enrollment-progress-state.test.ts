import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  getEnrollmentProgressState,
  matchesEnrollmentProgressFilter,
} from './enrollment-progress-state';

describe('getEnrollmentProgressState', () => {
  it('maps missing enrollment to not_started', () => {
    assert.equal(getEnrollmentProgressState(null, false), 'not_started');
    assert.equal(getEnrollmentProgressState(undefined, true), 'not_started');
  });

  it('maps active uncontacted to not_started and active contacted to active', () => {
    assert.equal(getEnrollmentProgressState('active', false), 'not_started');
    assert.equal(getEnrollmentProgressState('active', true), 'active');
  });

  it('passes through paused, completed, and stopped regardless of contact', () => {
    assert.equal(getEnrollmentProgressState('paused', false), 'paused');
    assert.equal(getEnrollmentProgressState('paused', true), 'paused');
    assert.equal(getEnrollmentProgressState('completed', false), 'completed');
    assert.equal(getEnrollmentProgressState('stopped', true), 'stopped');
  });
});

describe('matchesEnrollmentProgressFilter', () => {
  it('matches when filter list is empty', () => {
    assert.equal(matchesEnrollmentProgressFilter('not_started', []), true);
  });

  it('matches when progress state is included', () => {
    assert.equal(matchesEnrollmentProgressFilter('active', ['active', 'paused']), true);
    assert.equal(matchesEnrollmentProgressFilter('not_started', ['active']), false);
  });
});
