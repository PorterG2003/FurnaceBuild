import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertFlowEditAllowed,
  FLOW_LOCKED_RUNNING_STRUCTURAL,
  FLOW_TOAST_STOPPED,
  getFlowBadgeConfig,
  isContentEditAllowed,
  isFlowReadOnly,
  isStructuralEditAllowed,
} from './lifecycle.js';

test('getFlowEditPolicy allows content while running and structural while paused', () => {
  assert.equal(assertFlowEditAllowed('draft', 'structural').allowed, true);
  assert.equal(assertFlowEditAllowed('paused', 'structural').allowed, true);
  assert.equal(assertFlowEditAllowed('running', 'content').allowed, true);
  assert.equal(assertFlowEditAllowed('running', 'none').allowed, true);

  const runningStructural = assertFlowEditAllowed('running', 'structural');
  assert.equal(runningStructural.allowed, false);
  assert.equal(runningStructural.code, 'flow_locked');
  assert.equal(runningStructural.message, FLOW_LOCKED_RUNNING_STRUCTURAL);

  const stopped = assertFlowEditAllowed('stopped', 'content');
  assert.equal(stopped.allowed, false);
  assert.equal(stopped.message, FLOW_TOAST_STOPPED);
});

test('status helpers reflect live edit policy', () => {
  assert.equal(isFlowReadOnly('stopped'), true);
  assert.equal(isFlowReadOnly('running'), false);
  assert.equal(isContentEditAllowed('running'), true);
  assert.equal(isContentEditAllowed('stopped'), false);
  assert.equal(isStructuralEditAllowed('paused'), true);
  assert.equal(isStructuralEditAllowed('running'), false);
});

test('getFlowBadgeConfig returns status-aware labels', () => {
  assert.equal(getFlowBadgeConfig('draft'), null);
  assert.equal(getFlowBadgeConfig('running')?.secondaryLabel, 'Content only');
  assert.equal(getFlowBadgeConfig('running')?.showLockIcon, true);
  assert.equal(getFlowBadgeConfig('paused')?.secondaryLabel, 'Editable');
  assert.equal(getFlowBadgeConfig('paused')?.showLockIcon, false);
  assert.equal(getFlowBadgeConfig('stopped')?.secondaryLabel, 'Stopped');
});
