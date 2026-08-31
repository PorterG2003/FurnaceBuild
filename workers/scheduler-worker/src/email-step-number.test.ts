import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveEmailStepNumber } from './email-step-number.js';

const flowData = {
  nodes: [
    { id: 'leadSource-1', type: 'leadSource', position: { x: 0, y: 0 } },
    { id: 'email-1', type: 'email', position: { x: 200, y: 0 } },
    { id: 'wait-1', type: 'waitTime', position: { x: 400, y: 0 } },
    { id: 'email-2', type: 'email', position: { x: 600, y: 0 } },
  ],
  edges: [
    { source: 'leadSource-1', target: 'email-1' },
    { source: 'email-1', target: 'wait-1' },
    { source: 'wait-1', target: 'email-2' },
  ],
};

test('resolveEmailStepNumber returns 1-based email order', () => {
  assert.equal(resolveEmailStepNumber(flowData, 'email-1'), 1);
  assert.equal(resolveEmailStepNumber(flowData, 'email-2'), 2);
  assert.equal(resolveEmailStepNumber(flowData, 'wait-1'), undefined);
  assert.equal(resolveEmailStepNumber(flowData, null), undefined);
});
