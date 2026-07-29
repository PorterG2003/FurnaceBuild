import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ClientApiDbHarness,
  createClientApiTestNamespace,
} from './harness.js';

async function ensureHarnessReady(harness: ClientApiDbHarness) {
  await harness.campaignHarness.createCampaignGraph({
    name: 'Validation Fixture',
    status: 'draft',
    flowKind: 'emailOnly',
    leads: [],
  });
}

test('client api rejects non-uuid campaign id with 400 invalid_id', async () => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('invalid-uuid'),
  });

  try {
    await ensureHarnessReady(harness);
    const apiKey = await harness.createApiKey();
    const response = await harness.request('/v1/campaigns/not-a-uuid', {
      apiKey: apiKey.secret,
    });
    assert.equal(response.status, 400);
    const body = await response.json() as {
      error: { code: string; message: string; param?: string };
    };
    assert.equal(body.error.code, 'invalid_id');
    assert.equal(body.error.param, 'id');
    assert.doesNotMatch(body.error.code, /internal_error/);
  } finally {
    await harness.cleanup();
  }
});

test('client api nil uuid campaign id returns 404 not invalid_id', async () => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('nil-uuid'),
  });

  try {
    await ensureHarnessReady(harness);
    const apiKey = await harness.createApiKey();
    const response = await harness.request(
      '/v1/campaigns/00000000-0000-0000-0000-000000000000',
      { apiKey: apiKey.secret },
    );
    assert.equal(response.status, 404);
    const body = await response.json() as { error: { code: string } };
    assert.equal(body.error.code, 'campaign_not_found');
  } finally {
    await harness.cleanup();
  }
});

test('client api rejects invalid campaign status filter', async () => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('invalid-status'),
  });

  try {
    await ensureHarnessReady(harness);
    const apiKey = await harness.createApiKey();
    const bad = await harness.request('/v1/campaigns?status=exploded', {
      apiKey: apiKey.secret,
    });
    assert.equal(bad.status, 400);
    const badBody = await bad.json() as { error: { code: string; param?: string } };
    assert.equal(badBody.error.code, 'invalid_status');
    assert.equal(badBody.error.param, 'status');

    const ok = await harness.request('/v1/campaigns?status=draft&limit=1', {
      apiKey: apiKey.secret,
    });
    assert.equal(ok.status, 200);
  } finally {
    await harness.cleanup();
  }
});

test('client api createCampaign is idempotent with Idempotency-Key', async () => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('campaign-idem'),
  });
  const createdIds: string[] = [];

  try {
    await ensureHarnessReady(harness);
    const apiKey = await harness.createApiKey();
    const idemKey = `${harness.namespace}-campaign-create`;
    const payload = { name: `Idem Campaign ${harness.namespace}` };

    const first = await harness.request('/v1/campaigns', {
      method: 'POST',
      apiKey: apiKey.secret,
      headers: { 'Idempotency-Key': idemKey },
      body: payload,
    });
    assert.equal(first.status, 201);
    const firstBody = await first.json() as { data: { id: string; name: string } };
    assert.ok(firstBody.data.id);
    createdIds.push(firstBody.data.id);

    const second = await harness.request('/v1/campaigns', {
      method: 'POST',
      apiKey: apiKey.secret,
      headers: { 'Idempotency-Key': idemKey },
      body: payload,
    });
    assert.equal(second.status, 200);
    const secondBody = await second.json() as { data: { id: string; name: string } };
    assert.equal(secondBody.data.id, firstBody.data.id);

    const { data: campaigns, error: campaignsError } = await harness.supabase
      .from('campaigns')
      .select('id')
      .eq('account_id', harness.accountId)
      .eq('name', payload.name)
      .is('deleted_at', null);
    assert.equal(campaignsError, null);
    assert.equal(campaigns?.length, 1);

    const { data: idempotencyKeys, error: idempotencyError } = await harness.supabase
      .from('api_idempotency_keys')
      .select('id')
      .eq('account_id', harness.accountId)
      .eq('idempotency_key', idemKey);
    assert.equal(idempotencyError, null);
    assert.equal(idempotencyKeys?.length, 1);
  } finally {
    if (createdIds.length > 0) {
      await harness.supabase.from('campaigns').delete().in('id', createdIds);
    }
    await harness.cleanup();
  }
});

test('client api createCampaign omit schedule/interval applies Central 9-5 + 1440s defaults', async () => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('campaign-defaults'),
  });
  const createdIds: string[] = [];

  try {
    await ensureHarnessReady(harness);
    const apiKey = await harness.createApiKey();
    const created = await harness.request('/v1/campaigns', {
      method: 'POST',
      apiKey: apiKey.secret,
      body: { name: `Defaults ${harness.namespace}` },
    });
    assert.equal(created.status, 201);
    const body = await created.json() as {
      data: {
        id: string;
        schedule: {
          timezone: string;
          start_hour: number;
          end_hour: number;
          days_of_week: number[];
        };
        sending_interval_seconds: number;
      };
    };
    createdIds.push(body.data.id);
    assert.equal(body.data.sending_interval_seconds, 1440);
    assert.equal(body.data.schedule.timezone, 'America/Chicago');
    assert.equal(body.data.schedule.start_hour, 9);
    assert.equal(body.data.schedule.end_hour, 17);
    assert.deepEqual(body.data.schedule.days_of_week, [1, 2, 3, 4, 5]);

    const { data: row, error } = await harness.supabase
      .from('campaigns')
      .select('schedule, sending_interval_seconds')
      .eq('id', body.data.id)
      .single();
    assert.equal(error, null);
    assert.equal(row?.sending_interval_seconds, 1440);
    const schedule = row?.schedule as {
      timezone: string;
      start_hour: number;
      end_hour: number;
      days_of_week: number[];
    };
    assert.equal(schedule.timezone, 'America/Chicago');
    assert.equal(schedule.start_hour, 9);
    assert.equal(schedule.end_hour, 17);
    assert.deepEqual(schedule.days_of_week, [1, 2, 3, 4, 5]);
  } finally {
    if (createdIds.length > 0) {
      await harness.supabase.from('campaigns').delete().in('id', createdIds);
    }
    await harness.cleanup();
  }
});

test('client api createCampaign explicit null schedule is 24/7 with default interval', async () => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('campaign-null-sched'),
  });
  const createdIds: string[] = [];

  try {
    await ensureHarnessReady(harness);
    const apiKey = await harness.createApiKey();
    const created = await harness.request('/v1/campaigns', {
      method: 'POST',
      apiKey: apiKey.secret,
      body: { name: `Null Sched ${harness.namespace}`, schedule: null },
    });
    assert.equal(created.status, 201);
    const body = await created.json() as {
      data: { id: string; schedule: unknown; sending_interval_seconds: number };
    };
    createdIds.push(body.data.id);
    assert.equal(body.data.schedule, null);
    assert.equal(body.data.sending_interval_seconds, 1440);

    const { data: row, error } = await harness.supabase
      .from('campaigns')
      .select('schedule, sending_interval_seconds')
      .eq('id', body.data.id)
      .single();
    assert.equal(error, null);
    assert.equal(row?.schedule, null);
    assert.equal(row?.sending_interval_seconds, 1440);
  } finally {
    if (createdIds.length > 0) {
      await harness.supabase.from('campaigns').delete().in('id', createdIds);
    }
    await harness.cleanup();
  }
});

test('client api createCampaign explicit schedule and interval override defaults', async () => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('campaign-override'),
  });
  const createdIds: string[] = [];
  const schedule = {
    timezone: 'America/New_York',
    start_hour: 10,
    start_minute: 0,
    end_hour: 16,
    end_minute: 0,
    days_of_week: [1, 2, 3],
  };

  try {
    await ensureHarnessReady(harness);
    const apiKey = await harness.createApiKey();
    const created = await harness.request('/v1/campaigns', {
      method: 'POST',
      apiKey: apiKey.secret,
      body: {
        name: `Override ${harness.namespace}`,
        schedule,
        sending_interval_seconds: 300,
      },
    });
    assert.equal(created.status, 201);
    const body = await created.json() as {
      data: {
        id: string;
        schedule: typeof schedule;
        sending_interval_seconds: number;
      };
    };
    createdIds.push(body.data.id);
    assert.equal(body.data.sending_interval_seconds, 300);
    assert.equal(body.data.schedule.timezone, 'America/New_York');
    assert.equal(body.data.schedule.start_hour, 10);
    assert.equal(body.data.schedule.end_hour, 16);
    assert.deepEqual(body.data.schedule.days_of_week, [1, 2, 3]);

    const { data: row, error } = await harness.supabase
      .from('campaigns')
      .select('schedule, sending_interval_seconds')
      .eq('id', body.data.id)
      .single();
    assert.equal(error, null);
    assert.equal(row?.sending_interval_seconds, 300);
    const stored = row?.schedule as typeof schedule;
    assert.equal(stored.timezone, 'America/New_York');
    assert.equal(stored.start_hour, 10);
    assert.deepEqual(stored.days_of_week, [1, 2, 3]);
  } finally {
    if (createdIds.length > 0) {
      await harness.supabase.from('campaigns').delete().in('id', createdIds);
    }
    await harness.cleanup();
  }
});

test('client api rejects private webhook URLs', async () => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('webhook-ssrf'),
  });

  try {
    await ensureHarnessReady(harness);
    const apiKey = await harness.createApiKey();
    for (const webhook_url of [
      'https://localhost/hooks',
      'https://169.254.169.254/latest/meta-data/',
      'https://[::ffff:127.0.0.1]/',
      'https://[::ffff:7f00:1]/',
    ]) {
      const put = await harness.request('/v1/webhooks', {
        method: 'PUT',
        apiKey: apiKey.secret,
        body: { webhook_url, webhook_enabled_events: [] },
      });
      assert.equal(put.status, 400, webhook_url);
      const body = await put.json() as { error: { code: string } };
      assert.equal(body.error.code, 'invalid_webhook_url', webhook_url);
    }
  } finally {
    await harness.cleanup();
  }
});

test('client api rejects bad thread query params with 400', async () => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('thread-query'),
  });

  try {
    await ensureHarnessReady(harness);
    const apiKey = await harness.createApiKey();

    const tagIds = await harness.request('/v1/threads?tag_ids=not-a-uuid', {
      apiKey: apiKey.secret,
    });
    assert.equal(tagIds.status, 400);
    assert.equal(
      ((await tagIds.json()) as { error: { code: string } }).error.code,
      'invalid_id',
    );

    const dateFrom = await harness.request('/v1/threads?date_from=not-a-date', {
      apiKey: apiKey.secret,
    });
    assert.equal(dateFrom.status, 400);
    assert.equal(
      ((await dateFrom.json()) as { error: { code: string } }).error.code,
      'invalid_datetime',
    );

    const category = await harness.request('/v1/threads?category=Hacker', {
      apiKey: apiKey.secret,
    });
    assert.equal(category.status, 400);
    assert.equal(
      ((await category.json()) as { error: { code: string } }).error.code,
      'invalid_category',
    );
  } finally {
    await harness.cleanup();
  }
});

test('client api rejects campaign name with NUL', async () => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('nul-name'),
  });

  try {
    await ensureHarnessReady(harness);
    const apiKey = await harness.createApiKey();
    const response = await harness.request('/v1/campaigns', {
      method: 'POST',
      apiKey: apiKey.secret,
      body: { name: 'bad\u0000name' },
    });
    assert.equal(response.status, 400);
    const body = await response.json() as { error: { code: string } };
    assert.equal(body.error.code, 'invalid_string');
  } finally {
    await harness.cleanup();
  }
});

test('client api rejects dangerous block list values', async () => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('blocklist-val'),
  });

  try {
    await ensureHarnessReady(harness);
    const apiKey = await harness.createApiKey();

    const star = await harness.request('/v1/block-list', {
      method: 'POST',
      apiKey: apiKey.secret,
      body: { type: 'domain', value: '*' },
    });
    assert.equal(star.status, 400);
    assert.equal(
      ((await star.json()) as { error: { code: string } }).error.code,
      'invalid_domain',
    );

    const badEmail = await harness.request('/v1/block-list', {
      method: 'POST',
      apiKey: apiKey.secret,
      body: { type: 'email', value: 'not-an-email' },
    });
    assert.equal(badEmail.status, 400);
    assert.equal(
      ((await badEmail.json()) as { error: { code: string } }).error.code,
      'invalid_email',
    );
  } finally {
    await harness.cleanup();
  }
});
