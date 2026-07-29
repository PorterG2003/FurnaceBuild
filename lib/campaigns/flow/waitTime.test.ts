import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeFlowData, validateFlowData } from './index.js';
import {
  DEFAULT_WAIT_DURATION_SECONDS,
  MIN_WAIT_DURATION_SECONDS,
  resolveWaitDurationSeconds,
} from './waitTime.js';

test('resolveWaitDurationSeconds defaults empty/invalid to 3 days', () => {
  assert.equal(resolveWaitDurationSeconds({}), DEFAULT_WAIT_DURATION_SECONDS);
  assert.equal(resolveWaitDurationSeconds({ wait_duration_seconds: 0 }), DEFAULT_WAIT_DURATION_SECONDS);
  assert.equal(resolveWaitDurationSeconds({ duration: '' }), DEFAULT_WAIT_DURATION_SECONDS);
  assert.equal(resolveWaitDurationSeconds({ duration: 'abc', unit: 'hours' }), DEFAULT_WAIT_DURATION_SECONDS);
});

test('resolveWaitDurationSeconds clamps under-min values to 3 minutes', () => {
  assert.equal(resolveWaitDurationSeconds({ wait_duration_seconds: 60 }), MIN_WAIT_DURATION_SECONDS);
  assert.equal(
    resolveWaitDurationSeconds({ duration: '1', unit: 'minutes' }),
    MIN_WAIT_DURATION_SECONDS,
  );
});

test('resolveWaitDurationSeconds preserves valid durations', () => {
  assert.equal(resolveWaitDurationSeconds({ wait_duration_seconds: 7200 }), 7200);
  assert.equal(resolveWaitDurationSeconds({ duration: '2', unit: 'hours' }), 7200);
  assert.equal(resolveWaitDurationSeconds({ duration: '3', unit: 'days' }), DEFAULT_WAIT_DURATION_SECONDS);
});

test('normalizeFlowData applies wait default and min floor', () => {
  const withEmpty = normalizeFlowData({
    nodes: [
      { id: 'leadSource-1', type: 'leadSource', position: { x: 0, y: 0 }, data: {} },
      { id: 'wait-empty', type: 'waitTime', position: { x: 10, y: 0 }, data: { duration: '' } },
      {
        id: 'wait-short',
        type: 'waitTime',
        position: { x: 20, y: 0 },
        data: { wait_duration_seconds: 60 },
      },
    ],
    edges: [],
  });

  const emptyNode = withEmpty.nodes.find((node) => node.id === 'wait-empty');
  assert.equal(emptyNode?.data.wait_duration_seconds, DEFAULT_WAIT_DURATION_SECONDS);
  assert.equal(emptyNode?.data.duration, '3');
  assert.equal(emptyNode?.data.unit, 'days');

  const shortNode = withEmpty.nodes.find((node) => node.id === 'wait-short');
  assert.equal(shortNode?.data.wait_duration_seconds, MIN_WAIT_DURATION_SECONDS);
  assert.equal(shortNode?.data.duration, '3');
  assert.equal(shortNode?.data.unit, 'minutes');
});

test('validateFlowData rejects wait durations below the 3-minute minimum', () => {
  const result = validateFlowData({
    nodes: [
      {
        id: 'leadSource-1',
        type: 'leadSource',
        position: { x: 0, y: 0 },
        data: { label: 'Leads', customFieldKeys: [] },
      },
      {
        id: 'wait-under-min',
        type: 'waitTime',
        position: { x: 10, y: 0 },
        // Bypass normalize to assert validator floor directly.
        data: { wait_duration_seconds: 60, duration: '1', unit: 'minutes' },
      },
    ],
    edges: [{ id: 'e1', source: 'leadSource-1', target: 'wait-under-min' }],
  });

  assert.ok(
    result.issues.some(
      (issue) =>
        issue.code === 'invalid_wait_duration'
        && issue.path.includes('wait_duration_seconds'),
    ),
  );
});
