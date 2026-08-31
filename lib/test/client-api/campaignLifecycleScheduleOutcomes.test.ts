import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ClientApiDbHarness,
  createClientApiTestNamespace,
} from './harness.js';
import {
  cleanupCreatedCampaign,
  linearFlowForApi,
  saveFlow,
} from './flowApiHelpers.js';

type CampaignBody = {
  data: {
    id: string;
    status: string;
    lifecycle_schedule?: {
      time_zone: string;
      start_on: string | null;
      pause_on: string | null;
      start_at: string | null;
      pause_at: string | null;
    };
    start_date?: unknown;
    pause_date?: unknown;
    start_at?: unknown;
    pause_at?: unknown;
    schedule_timezone?: unknown;
  };
};

test('client api lifecycle_schedule create, omit vs null, launch, and validation', async () => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('lifecycle-schedule'),
  });
  const createdIds: string[] = [];

  try {
    const seedGraph = await harness.campaignHarness.createCampaignGraph({
      name: 'Lifecycle Schedule Mailboxes',
      status: 'draft',
      flowKind: 'emailOnly',
      leads: [],
      mailboxes: [
        {
          key: 'mailbox-1',
          emailAddress: `seed-${harness.namespace}@example.com`,
          displayName: 'Seed Sender',
        },
      ],
    });
    const apiKey = await harness.createApiKey();
    const mailboxId = seedGraph.mailboxIdsByKey.get('mailbox-1');
    assert.ok(mailboxId);

    const created = await harness.request('/v1/campaigns', {
      method: 'POST',
      apiKey: apiKey.secret,
      body: {
        name: 'Scheduled Launch Campaign',
        mailbox_ids: [mailboxId],
        lifecycle_schedule: {
          time_zone: 'America/Chicago',
          start_on: '2099-01-15',
          pause_on: null,
        },
      },
    });
    assert.equal(created.status, 201);
    const createdBody = await created.json() as CampaignBody;
    createdIds.push(createdBody.data.id);
    assert.equal(createdBody.data.status, 'draft');
    assert.equal(createdBody.data.lifecycle_schedule?.time_zone, 'America/Chicago');
    assert.equal(createdBody.data.lifecycle_schedule?.start_on, '2099-01-15');
    assert.equal(createdBody.data.lifecycle_schedule?.pause_on, null);
    assert.equal(typeof createdBody.data.lifecycle_schedule?.start_at, 'string');
    assert.equal('start_date' in createdBody.data, false);
    assert.equal('schedule_timezone' in createdBody.data, false);
    assert.equal('start_at' in createdBody.data, false);

    const writableAt = await harness.request(`/v1/campaigns/${createdBody.data.id}`, {
      method: 'PATCH',
      apiKey: apiKey.secret,
      body: {
        lifecycle_schedule: {
          time_zone: 'America/Chicago',
          start_on: '2099-01-15',
          pause_on: null,
          start_at: '2000-01-01T00:00:00.000Z',
        },
      },
    });
    assert.equal(writableAt.status, 200);
    const patchedKeep = await writableAt.json() as CampaignBody;
    assert.equal(patchedKeep.data.lifecycle_schedule?.start_on, '2099-01-15');
    assert.notEqual(patchedKeep.data.lifecycle_schedule?.start_at, '2000-01-01T00:00:00.000Z');

    const omitted = await harness.request(`/v1/campaigns/${createdBody.data.id}`, {
      method: 'PATCH',
      apiKey: apiKey.secret,
      body: { name: 'Scheduled Launch Campaign renamed' },
    });
    assert.equal(omitted.status, 200);
    const omittedBody = await omitted.json() as CampaignBody;
    assert.equal(omittedBody.data.lifecycle_schedule?.start_on, '2099-01-15');

    const cleared = await harness.request(`/v1/campaigns/${createdBody.data.id}`, {
      method: 'PATCH',
      apiKey: apiKey.secret,
      body: { lifecycle_schedule: null },
    });
    assert.equal(cleared.status, 200);
    const clearedBody = await cleared.json() as CampaignBody;
    assert.equal(clearedBody.data.lifecycle_schedule?.start_on, null);
    assert.equal(clearedBody.data.lifecycle_schedule?.pause_on, null);
    assert.equal(clearedBody.data.lifecycle_schedule?.time_zone, 'America/Chicago');

    const restore = await harness.request(`/v1/campaigns/${createdBody.data.id}`, {
      method: 'PATCH',
      apiKey: apiKey.secret,
      body: {
        lifecycle_schedule: {
          time_zone: 'America/Chicago',
          start_on: '2099-01-15',
          pause_on: '2099-02-01',
        },
      },
    });
    assert.equal(restore.status, 200);

    const invalidDates = await harness.request(`/v1/campaigns/${createdBody.data.id}`, {
      method: 'PATCH',
      apiKey: apiKey.secret,
      body: {
        lifecycle_schedule: {
          time_zone: 'America/Chicago',
          start_on: '2099-02-01',
          pause_on: '2099-02-01',
        },
      },
    });
    assert.equal(invalidDates.status, 400);
    const invalidBody = await invalidDates.json() as { error: { code: string } };
    assert.equal(invalidBody.error.code, 'invalid_lifecycle_dates');

    const conflict = await harness.request(`/v1/campaigns/${createdBody.data.id}`, {
      method: 'PATCH',
      apiKey: apiKey.secret,
      body: {
        schedule: {
          timezone: 'America/New_York',
          start_hour: 9,
          end_hour: 17,
          days_of_week: [1, 2, 3, 4, 5],
        },
        lifecycle_schedule: {
          time_zone: 'America/Chicago',
          start_on: '2099-01-15',
          pause_on: null,
        },
      },
    });
    assert.equal(conflict.status, 400);
    const conflictBody = await conflict.json() as { error: { code: string } };
    assert.equal(conflictBody.error.code, 'timezone_conflict');

    const flowPost = await saveFlow(harness, createdBody.data.id, linearFlowForApi(), {
      method: 'POST',
      apiKey: apiKey.secret,
    });
    assert.equal(flowPost.status, 200);

    const leadCreate = await harness.request(`/v1/campaigns/${createdBody.data.id}/leads`, {
      method: 'POST',
      apiKey: apiKey.secret,
      body: {
        email: `sched-${harness.namespace}@example.com`,
        first_name: 'Scheduled',
        last_name: 'Lead',
        custom_lead_data: { company: 'Furnace' },
      },
    });
    assert.equal(leadCreate.status, 201, JSON.stringify(await leadCreate.clone().json()));

    const launched = await harness.request(`/v1/campaigns/${createdBody.data.id}/launch`, {
      method: 'POST',
      apiKey: apiKey.secret,
      body: {},
    });
    assert.equal(launched.status, 200);
    const launchedBody = await launched.json() as {
      data: {
        id: string;
        status: string;
        enrolled: number;
        lifecycle_schedule: { start_on: string | null };
      };
    };
    assert.equal(launchedBody.data.status, 'scheduled');
    assert.equal(launchedBody.data.enrolled, 1);
    assert.equal(launchedBody.data.lifecycle_schedule.start_on, '2099-01-15');

    const immediate = await harness.request('/v1/campaigns', {
      method: 'POST',
      apiKey: apiKey.secret,
      body: {
        name: 'Immediate Launch Campaign',
        mailbox_ids: [mailboxId],
        lifecycle_schedule: {
          time_zone: 'America/Chicago',
          start_on: null,
          pause_on: null,
        },
      },
    });
    assert.equal(immediate.status, 201);
    const immediateBody = await immediate.json() as CampaignBody;
    createdIds.push(immediateBody.data.id);

    const immediateFlow = await saveFlow(harness, immediateBody.data.id, linearFlowForApi(), {
      method: 'POST',
      apiKey: apiKey.secret,
    });
    assert.equal(flowPost.status, 200);
    assert.equal(immediateFlow.status, 200);
    const immediateLead = await harness.request(`/v1/campaigns/${immediateBody.data.id}/leads`, {
      method: 'POST',
      apiKey: apiKey.secret,
      body: {
        email: `run-${harness.namespace}@example.com`,
        first_name: 'Runner',
        last_name: 'Lead',
        custom_lead_data: { company: 'Furnace' },
      },
    });
    assert.equal(immediateLead.status, 201);
    const immediateLaunch = await harness.request(`/v1/campaigns/${immediateBody.data.id}/launch`, {
      method: 'POST',
      apiKey: apiKey.secret,
      body: {},
    });
    assert.equal(immediateLaunch.status, 200);
    const immediateLaunchBody = await immediateLaunch.json() as { data: { status: string } };
    assert.equal(immediateLaunchBody.data.status, 'running');

    const listed = await harness.request('/v1/campaigns?status=scheduled', {
      apiKey: apiKey.secret,
    });
    assert.equal(listed.status, 200);
    const listedBody = await listed.json() as { data: Array<{ id: string; status: string }> };
    assert.ok(listedBody.data.some((row) => row.id === createdBody.data.id && row.status === 'scheduled'));
  } finally {
    for (const id of createdIds) {
      await cleanupCreatedCampaign(harness, id);
    }
    await harness.cleanup();
  }
});
