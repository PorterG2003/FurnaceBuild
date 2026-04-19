import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatUnknownError,
  reportErrorToSlack,
  resetSlackAggregationStateForTests,
} from './reportErrorToSlack.js';

test('formatUnknownError unwraps plain object with message', () => {
  const out = formatUnknownError({ message: 'upstream timeout', code: '57014' });
  assert.match(out, /upstream timeout/);
  assert.match(out, /code=57014/);
});

test('formatUnknownError handles Error instances', () => {
  assert.equal(formatUnknownError(new Error('boom')), 'boom');
});

test('formatUnknownError avoids [object Object] for plain objects', () => {
  assert.notEqual(formatUnknownError({ foo: 1 }), '[object Object]');
});

test('reportErrorToSlack posts first alert immediately and summary on rollover', () => {
  const originalFetch = global.fetch;
  const originalWebhook = process.env.SLACK_ERROR_WEBHOOK_URL;
  const originalNow = Date.now;
  const calls: Array<{ url: string | URL | Request; text: string }> = [];
  let now = Date.parse('2026-04-18T15:00:00.000Z');

  Date.now = () => now;

  global.fetch = ((url, init) => {
    calls.push({
      url,
      text: String(init?.body ?? ''),
    });
    return Promise.resolve(new Response(null, { status: 200 }));
  }) as typeof fetch;

  process.env.SLACK_ERROR_WEBHOOK_URL = 'https://example.com/webhook';
  resetSlackAggregationStateForTests();

  try {
    reportErrorToSlack('Repeated warning', {
      severity: 'warning',
      error: 'temporary upstream 503',
      alertPolicy: 'transient_retryable_warning',
      aggregationKey: 'test-warning',
      aggregationWindowMs: 60_000,
      summaryFields: { campaign_id: 'campaign-123' },
    });
    reportErrorToSlack('Repeated warning', {
      severity: 'warning',
      error: 'temporary upstream 503',
      alertPolicy: 'transient_retryable_warning',
      aggregationKey: 'test-warning',
      aggregationWindowMs: 60_000,
      summaryFields: { campaign_id: 'campaign-123' },
    });

    assert.equal(calls.length, 1);
    assert.match(calls[0].text, /Repeated warning/);

    now += 61_000;
    reportErrorToSlack('Repeated warning', {
      severity: 'warning',
      error: 'temporary upstream 503',
      alertPolicy: 'transient_retryable_warning',
      aggregationKey: 'test-warning',
      aggregationWindowMs: 60_000,
      summaryFields: { campaign_id: 'campaign-123' },
    });

    assert.equal(calls.length, 2);
    assert.match(calls[1].text, /Repeated warning \(summary\)/);
    assert.match(calls[1].text, /occurrences: 2/);
    assert.match(calls[1].text, /window: 1m/);
    assert.match(calls[1].text, /campaign_id: campaign-123/);
  } finally {
    resetSlackAggregationStateForTests();
    Date.now = originalNow;
    global.fetch = originalFetch;
    if (originalWebhook === undefined) {
      delete process.env.SLACK_ERROR_WEBHOOK_URL;
    } else {
      process.env.SLACK_ERROR_WEBHOOK_URL = originalWebhook;
    }
  }
});

test('reportErrorToSlack keeps aggregation keys isolated', () => {
  const originalFetch = global.fetch;
  const originalWebhook = process.env.SLACK_ERROR_WEBHOOK_URL;
  const calls: string[] = [];

  global.fetch = ((_url, init) => {
    calls.push(String(init?.body ?? ''));
    return Promise.resolve(new Response(null, { status: 200 }));
  }) as typeof fetch;

  process.env.SLACK_ERROR_WEBHOOK_URL = 'https://example.com/webhook';
  resetSlackAggregationStateForTests();

  try {
    reportErrorToSlack('Campaign A warning', {
      alertPolicy: 'transient_retryable_warning',
      aggregationKey: 'campaign-a',
      error: '503',
    });
    reportErrorToSlack('Campaign B warning', {
      alertPolicy: 'transient_retryable_warning',
      aggregationKey: 'campaign-b',
      error: '503',
    });

    assert.equal(calls.length, 2);
  } finally {
    resetSlackAggregationStateForTests();
    global.fetch = originalFetch;
    if (originalWebhook === undefined) {
      delete process.env.SLACK_ERROR_WEBHOOK_URL;
    } else {
      process.env.SLACK_ERROR_WEBHOOK_URL = originalWebhook;
    }
  }
});

test('critical policy bypasses aggregation', () => {
  const originalFetch = global.fetch;
  const originalWebhook = process.env.SLACK_ERROR_WEBHOOK_URL;
  const calls: string[] = [];

  global.fetch = ((_url, init) => {
    calls.push(String(init?.body ?? ''));
    return Promise.resolve(new Response(null, { status: 200 }));
  }) as typeof fetch;

  process.env.SLACK_ERROR_WEBHOOK_URL = 'https://example.com/webhook';
  resetSlackAggregationStateForTests();

  try {
    reportErrorToSlack('Critical failure', {
      severity: 'critical',
      alertPolicy: 'critical_failure',
      aggregationKey: 'critical-key',
      error: 'boom',
    });
    reportErrorToSlack('Critical failure', {
      severity: 'critical',
      alertPolicy: 'critical_failure',
      aggregationKey: 'critical-key',
      error: 'boom',
    });

    assert.equal(calls.length, 2);
  } finally {
    resetSlackAggregationStateForTests();
    global.fetch = originalFetch;
    if (originalWebhook === undefined) {
      delete process.env.SLACK_ERROR_WEBHOOK_URL;
    } else {
      process.env.SLACK_ERROR_WEBHOOK_URL = originalWebhook;
    }
  }
});

test('gateway summaries are preserved in aggregated summaries', () => {
  const originalFetch = global.fetch;
  const originalWebhook = process.env.SLACK_ERROR_WEBHOOK_URL;
  const originalNow = Date.now;
  const calls: string[] = [];
  let now = Date.parse('2026-04-18T15:00:00.000Z');

  Date.now = () => now;
  global.fetch = ((_url, init) => {
    calls.push(String(init?.body ?? ''));
    return Promise.resolve(new Response(null, { status: 200 }));
  }) as typeof fetch;

  process.env.SLACK_ERROR_WEBHOOK_URL = 'https://example.com/webhook';
  resetSlackAggregationStateForTests();

  const rawGatewayError =
    '<html><head></head><body><center><h1>502 Bad Gateway</h1></center><hr><center>cloudflare</center><div>Ray ID: 9eef378cfa189976</div></body></html>';

  try {
    reportErrorToSlack('Gateway warning', {
      alertPolicy: 'transient_retryable_warning',
      aggregationKey: 'gateway-key',
      aggregationWindowMs: 60_000,
      error: rawGatewayError,
    });
    reportErrorToSlack('Gateway warning', {
      alertPolicy: 'transient_retryable_warning',
      aggregationKey: 'gateway-key',
      aggregationWindowMs: 60_000,
      error: rawGatewayError,
    });

    now += 61_000;
    reportErrorToSlack('Gateway warning', {
      alertPolicy: 'transient_retryable_warning',
      aggregationKey: 'gateway-key',
      aggregationWindowMs: 60_000,
      error: rawGatewayError,
    });

    assert.equal(calls.length, 2);
    assert.match(calls[1], /Transient HTTP 502 from Supabase/);
    assert.match(calls[1], /ray_id: 9eef378cfa189976/);
  } finally {
    resetSlackAggregationStateForTests();
    Date.now = originalNow;
    global.fetch = originalFetch;
    if (originalWebhook === undefined) {
      delete process.env.SLACK_ERROR_WEBHOOK_URL;
    } else {
      process.env.SLACK_ERROR_WEBHOOK_URL = originalWebhook;
    }
  }
});
