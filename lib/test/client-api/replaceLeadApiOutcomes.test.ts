import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ClientApiDbHarness,
  createClientApiTestNamespace,
} from './harness.js';
import {
  buildCampaignEnrollment,
  buildCampaignLead,
  buildCampaignThread,
  buildThreadMessage,
} from '../campaign/fixtures.js';

async function ensurePreviewRpc(
  harness: ClientApiDbHarness,
  t: test.TestContext,
): Promise<boolean> {
  const { error } = await harness.supabase.rpc('preview_replacement_target', {
    p_account_id: '00000000-0000-4000-8000-000000000000',
    p_campaign_id: '00000000-0000-4000-8000-000000000001',
    p_email: 'probe@example.com',
    p_old_lead_id: null,
  });
  if (error && /Could not find the function|does not exist|schema cache/i.test(error.message)) {
    t.skip(`preview_replacement_target not applied in shared test DB: ${error.message}`);
    return false;
  }
  return true;
}

test('client api replace-lead preview reports created, attached, blocked, and enrollment guard', async (t) => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('replace-preview'),
  });
  const createdBlockIds: string[] = [];

  try {
    if (!(await ensurePreviewRpc(harness, t))) return;

    const targetEmail = `attach-${harness.namespace}@furnace.test`;
    const blockedEmail = `blocked-${harness.namespace}@furnace.test`;
    const orphanEmail = `orphan-${harness.namespace}@furnace.test`;
    const graph = await harness.campaignHarness.createCampaignGraph({
      name: 'Client API Replace Preview',
      status: 'running',
      flowKind: 'emailOnly',
      mailboxes: [
        {
          key: 'mailbox-1',
          emailAddress: `sender-${harness.namespace}@example.com`,
          displayName: 'Sender',
        },
      ],
      leads: [
        buildCampaignLead({
          key: 'old',
          email: `old-${harness.namespace}@furnace.test`,
          mailboxKey: 'mailbox-1',
          enrollment: buildCampaignEnrollment({ state: 'active', currentFlowNodeId: 'email-1' }),
          thread: buildCampaignThread({
            subject: 'Replace preview thread',
            messages: [
              buildThreadMessage({
                direction: 'sent',
                subject: 'Hello',
                bodyText: 'First touch',
                fromEmail: `sender-${harness.namespace}@example.com`,
                toEmail: `old-${harness.namespace}@furnace.test`,
              }),
            ],
          }),
        }),
        buildCampaignLead({
          key: 'target',
          email: targetEmail,
          firstName: 'Blake',
          lastName: 'Attach',
          companyName: 'Attach Co',
          mailboxKey: 'mailbox-1',
          enrollment: buildCampaignEnrollment({ state: 'active', currentFlowNodeId: 'email-1' }),
        }),
        buildCampaignLead({
          key: 'orphan',
          email: orphanEmail,
          mailboxKey: 'mailbox-1',
          // No enrollment — attach should be refused.
        }),
      ],
    });

    const apiKey = await harness.createApiKey();
    const threadId = graph.leadsByKey.get('old')!.threadId!;
    const oldEmail = `old-${harness.namespace}@furnace.test`;
    const target = graph.leadsByKey.get('target')!;

    const createdPreview = await harness.request(
      `/v1/threads/${threadId}/replace-lead/preview?email=${encodeURIComponent(`brand-new-${harness.namespace}@furnace.test`)}`,
      { apiKey: apiKey.secret },
    );
    assert.equal(createdPreview.status, 200);
    const createdBody = await createdPreview.json() as {
      data: {
        mode: string;
        allowed: boolean;
        disallowed_reason: string | null;
        existing_lead: null;
        match_count: number;
      };
    };
    assert.equal(createdBody.data.mode, 'created');
    assert.equal(createdBody.data.allowed, true);
    assert.equal(createdBody.data.disallowed_reason, null);
    assert.equal(createdBody.data.existing_lead, null);
    assert.equal(createdBody.data.match_count, 0);

    const attachedPreview = await harness.request(
      `/v1/threads/${threadId}/replace-lead/preview?email=${encodeURIComponent(targetEmail)}`,
      { apiKey: apiKey.secret },
    );
    assert.equal(attachedPreview.status, 200);
    const attachedBody = await attachedPreview.json() as {
      data: {
        mode: string;
        allowed: boolean;
        match_count: number;
        existing_lead: {
          id: string;
          company_name: string | null;
          first_name: string | null;
          enrollment_id: string | null;
        } | null;
      };
    };
    assert.equal(attachedBody.data.mode, 'attached');
    assert.equal(attachedBody.data.allowed, true);
    assert.equal(attachedBody.data.existing_lead?.id, target.leadId);
    assert.equal(attachedBody.data.existing_lead?.company_name, 'Attach Co');
    assert.equal(attachedBody.data.existing_lead?.first_name, 'Blake');
    assert.ok(attachedBody.data.existing_lead?.enrollment_id);

    const samePreview = await harness.request(
      `/v1/threads/${threadId}/replace-lead/preview?email=${encodeURIComponent(oldEmail)}`,
      { apiKey: apiKey.secret },
    );
    assert.equal(samePreview.status, 200);
    const sameBody = await samePreview.json() as {
      data: { allowed: boolean; disallowed_reason: string | null; matches_current_lead: boolean };
    };
    assert.equal(sameBody.data.allowed, false);
    assert.equal(sameBody.data.disallowed_reason, 'same_as_current_lead');
    assert.equal(sameBody.data.matches_current_lead, true);

    const orphanPreview = await harness.request(
      `/v1/threads/${threadId}/replace-lead/preview?email=${encodeURIComponent(orphanEmail)}`,
      { apiKey: apiKey.secret },
    );
    assert.equal(orphanPreview.status, 200);
    const orphanBody = await orphanPreview.json() as {
      data: { mode: string; allowed: boolean; disallowed_reason: string | null };
    };
    assert.equal(orphanBody.data.mode, 'attached');
    assert.equal(orphanBody.data.allowed, false);
    assert.equal(orphanBody.data.disallowed_reason, 'target_missing_enrollment');

    const { data: blockRows, error: blockError } = await harness.supabase
      .from('block_list')
      .insert([
        {
          account_id: harness.accountId,
          type: 'email',
          value: blockedEmail,
          reason: 'unsubscribed',
        },
      ] as any)
      .select('id');
    assert.equal(blockError, null, blockError?.message);
    createdBlockIds.push(...(blockRows ?? []).map((row: any) => row.id));

    const blockedPreview = await harness.request(
      `/v1/threads/${threadId}/replace-lead/preview?email=${encodeURIComponent(blockedEmail)}`,
      { apiKey: apiKey.secret },
    );
    assert.equal(blockedPreview.status, 200);
    const blockedBody = await blockedPreview.json() as {
      data: { blocked: boolean; block_reason: string | null; mode: string };
    };
    assert.equal(blockedBody.data.blocked, true);
    assert.equal(blockedBody.data.block_reason, 'unsubscribed');
    assert.equal(blockedBody.data.mode, 'created');

    const missingEmail = await harness.request(
      `/v1/threads/${threadId}/replace-lead/preview`,
      { apiKey: apiKey.secret },
    );
    assert.equal(missingEmail.status, 400);
    const missingBody = await missingEmail.json() as { error: { code: string } };
    assert.equal(missingBody.error.code, 'missing_email');
  } finally {
    if (createdBlockIds.length > 0) {
      await harness.supabase.from('block_list').delete().in('id', createdBlockIds);
    }
    await harness.cleanup();
  }
});

test('client api replace-lead attach returns mode, target_lead_id, and retired siblings', async (t) => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('replace-attach'),
  });

  try {
    if (!(await ensurePreviewRpc(harness, t))) return;

    const targetEmail = `attach-write-${harness.namespace}@furnace.test`;
    const graph = await harness.campaignHarness.createCampaignGraph({
      name: 'Client API Replace Attach',
      status: 'running',
      flowKind: 'emailOnly',
      mailboxes: [
        {
          key: 'mailbox-1',
          emailAddress: `sender-${harness.namespace}@example.com`,
          displayName: 'Sender',
        },
      ],
      leads: [
        buildCampaignLead({
          key: 'old',
          email: `old-write-${harness.namespace}@furnace.test`,
          mailboxKey: 'mailbox-1',
          enrollment: buildCampaignEnrollment({ state: 'active', currentFlowNodeId: 'email-1' }),
          thread: buildCampaignThread({
            subject: 'Replace attach thread',
            messages: [
              buildThreadMessage({
                direction: 'received',
                subject: 'Re: Hello',
                bodyText: 'Please talk to Blake',
                fromEmail: `old-write-${harness.namespace}@furnace.test`,
                toEmail: `sender-${harness.namespace}@example.com`,
              }),
            ],
          }),
        }),
        buildCampaignLead({
          key: 'target',
          email: targetEmail,
          mailboxKey: 'mailbox-1',
          enrollment: buildCampaignEnrollment({ state: 'active', currentFlowNodeId: 'email-1' }),
        }),
        buildCampaignLead({
          key: 'sibling',
          email: targetEmail,
          mailboxKey: 'mailbox-1',
          enrollment: buildCampaignEnrollment({ state: 'active', currentFlowNodeId: 'email-1' }),
        }),
      ],
    });

    const apiKey = await harness.createApiKey();
    const threadId = graph.leadsByKey.get('old')!.threadId!;
    const target = graph.leadsByKey.get('target')!;

    const replaceLead = await harness.request(`/v1/threads/${threadId}/replace-lead`, {
      method: 'POST',
      apiKey: apiKey.secret,
      body: {
        new_email: targetEmail,
        new_name: 'Ignored On Attach',
        new_mobile_phone_number: '555-0100',
        reason: 'manual_referral',
      },
    });
    assert.equal(replaceLead.status, 200, await replaceLead.clone().text());
    const replaceBody = await replaceLead.json() as {
      data: {
        mode: string;
        new_lead_id: string;
        target_lead_id: string | null;
        retired_sibling_count: number;
        replacement_id: string;
      };
    };
    assert.equal(replaceBody.data.mode, 'attached');
    assert.equal(replaceBody.data.new_lead_id, target.leadId);
    assert.equal(replaceBody.data.target_lead_id, target.leadId);
    assert.ok(replaceBody.data.retired_sibling_count >= 1);
    assert.ok(replaceBody.data.replacement_id);

    const { data: refreshedThread, error: refreshedError } = await harness.supabase
      .from('email_threads')
      .select('lead_id')
      .eq('id', threadId)
      .single();
    assert.equal(refreshedError, null, refreshedError?.message);
    assert.equal(refreshedThread?.lead_id, target.leadId);
  } finally {
    await harness.cleanup();
  }
});

test('client api replace-lead returns structured errors for same email, already replaced, and missing enrollment', async (t) => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('replace-errors'),
  });

  try {
    if (!(await ensurePreviewRpc(harness, t))) return;

    const orphanEmail = `orphan-err-${harness.namespace}@furnace.test`;
    const attachEmail = `attach-err-${harness.namespace}@furnace.test`;
    const graph = await harness.campaignHarness.createCampaignGraph({
      name: 'Client API Replace Errors',
      status: 'running',
      flowKind: 'emailOnly',
      mailboxes: [
        {
          key: 'mailbox-1',
          emailAddress: `sender-${harness.namespace}@example.com`,
          displayName: 'Sender',
        },
      ],
      leads: [
        buildCampaignLead({
          key: 'old',
          email: `old-err-${harness.namespace}@furnace.test`,
          mailboxKey: 'mailbox-1',
          enrollment: buildCampaignEnrollment({ state: 'active', currentFlowNodeId: 'email-1' }),
          thread: buildCampaignThread({
            subject: 'Replace error thread',
            messages: [
              buildThreadMessage({
                direction: 'sent',
                subject: 'Hello',
                bodyText: 'First touch',
                fromEmail: `sender-${harness.namespace}@example.com`,
                toEmail: `old-err-${harness.namespace}@furnace.test`,
              }),
            ],
          }),
        }),
        buildCampaignLead({
          key: 'orphan',
          email: orphanEmail,
          mailboxKey: 'mailbox-1',
        }),
        buildCampaignLead({
          key: 'attach-target',
          email: attachEmail,
          mailboxKey: 'mailbox-1',
          enrollment: buildCampaignEnrollment({ state: 'active', currentFlowNodeId: 'email-1' }),
        }),
      ],
    });

    const apiKey = await harness.createApiKey();
    const threadId = graph.leadsByKey.get('old')!.threadId!;
    const oldLead = graph.leadsByKey.get('old')!;
    const oldEmail = `old-err-${harness.namespace}@furnace.test`;

    const sameEmail = await harness.request(`/v1/threads/${threadId}/replace-lead`, {
      method: 'POST',
      apiKey: apiKey.secret,
      body: { new_email: oldEmail },
    });
    assert.equal(sameEmail.status, 400);
    const sameBody = await sameEmail.json() as { error: { code: string; param?: string } };
    assert.equal(sameBody.error.code, 'same_as_current_lead');
    assert.equal(sameBody.error.param, 'new_email');

    const invalidReason = await harness.request(`/v1/threads/${threadId}/replace-lead`, {
      method: 'POST',
      apiKey: apiKey.secret,
      body: {
        new_email: `reason-${harness.namespace}@furnace.test`,
        reason: 'not_a_reason',
      },
    });
    assert.equal(invalidReason.status, 400);
    const reasonBody = await invalidReason.json() as { error: { code: string; param?: string } };
    assert.equal(reasonBody.error.code, 'invalid_reason');
    assert.equal(reasonBody.error.param, 'reason');

    const missingEnrollment = await harness.request(`/v1/threads/${threadId}/replace-lead`, {
      method: 'POST',
      apiKey: apiKey.secret,
      body: { new_email: orphanEmail },
    });
    assert.equal(missingEnrollment.status, 409);
    const missingBody = await missingEnrollment.json() as { error: { code: string; message: string } };
    assert.equal(missingBody.error.code, 'target_missing_enrollment');
    assert.match(missingBody.error.message, /preview/i);

    // Attach keeps the old lead alive (stopped/replaced) with a replacement row,
    // unlike create which soft-deletes it. Point the thread back at the old lead
    // to hit lead_already_replaced.
    const attachOnce = await harness.request(`/v1/threads/${threadId}/replace-lead`, {
      method: 'POST',
      apiKey: apiKey.secret,
      body: { new_email: attachEmail },
    });
    assert.equal(attachOnce.status, 200, await attachOnce.clone().text());

    const { error: restoreError } = await harness.supabase
      .from('email_threads')
      .update({ lead_id: oldLead.leadId } as any)
      .eq('id', threadId);
    assert.equal(restoreError, null, restoreError?.message);

    const alreadyReplaced = await harness.request(`/v1/threads/${threadId}/replace-lead`, {
      method: 'POST',
      apiKey: apiKey.secret,
      body: { new_email: `second-replace-${harness.namespace}@furnace.test` },
    });
    assert.equal(alreadyReplaced.status, 409);
    const alreadyBody = await alreadyReplaced.json() as { error: { code: string } };
    assert.equal(alreadyBody.error.code, 'lead_already_replaced');
  } finally {
    await harness.cleanup();
  }
});
