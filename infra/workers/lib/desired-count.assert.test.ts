import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  WORKER_CONTAINER_INSIGHTS,
  WORKER_DESIRED_COUNTS,
  workerDesiredCountForStack,
} from './desired-counts';

describe('WORKER_DESIRED_COUNTS', () => {
  it('keeps dev workers at zero by default', () => {
    assert.deepEqual(WORKER_DESIRED_COUNTS.dev, { send: 0, scheduler: 0, inbox: 0 });
    assert.deepEqual(workerDesiredCountForStack('dev'), {
      sendWorker: 0,
      schedulerWorker: 0,
      inboxCheckerWorker: 0,
    });
  });

  it('never sets prod worker desired counts to zero', () => {
    const prod = WORKER_DESIRED_COUNTS.prod;
    assert.ok(prod.send >= 1, 'prod send worker must stay >= 1');
    assert.ok(prod.scheduler >= 1, 'prod scheduler worker must stay >= 1');
    assert.ok(prod.inbox >= 1, 'prod inbox worker must stay >= 1');

    const stackShape = workerDesiredCountForStack('prod');
    assert.ok(stackShape.sendWorker >= 1);
    assert.ok(stackShape.schedulerWorker >= 1);
    assert.ok(stackShape.inboxCheckerWorker >= 1);
  });
});

describe('WORKER_CONTAINER_INSIGHTS policy', () => {
  it('documents intended Container Insights: dev off, prod on', () => {
    assert.equal(WORKER_CONTAINER_INSIGHTS.dev, false);
    assert.equal(WORKER_CONTAINER_INSIGHTS.prod, true);
  });
});
