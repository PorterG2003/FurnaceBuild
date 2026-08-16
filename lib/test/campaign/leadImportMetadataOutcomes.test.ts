import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { CampaignDbHarness } from './harness';
import {
  buildCampaignEnrollment,
  buildCampaignLead,
  createCampaignTestNamespace,
} from './fixtures';

function hashGlobalLeadId(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}

function isMissingSchema(error: { message?: string; code?: string } | null): boolean {
  const message = error?.message ?? '';
  if (
    !message.includes('import_api_leads_to_campaign') &&
    !message.includes('lead_tag_assignments') &&
    !message.includes('lead_email_facts') &&
    !message.includes('p_tag_ids') &&
    !message.includes('private_apply_lead_import_metadata')
  ) {
    return false;
  }
  return (
    error?.code === 'PGRST202' ||
    error?.code === 'PGRST203' ||
    message.includes('does not exist') ||
    message.includes('schema cache')
  );
}

test('import_api_leads_to_campaign persists tags and email verification', async (t) => {
  const harness = new CampaignDbHarness({
    namespace: createCampaignTestNamespace('lead-meta'),
  });
  const email = `tagged-${harness.namespace}@furnace.test`;
  const globalLeadId = hashGlobalLeadId(email);

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Import Metadata',
      status: 'draft',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'seed',
          email: `seed-${harness.namespace}@furnace.test`,
          enrollment: buildCampaignEnrollment({ state: 'active' }),
        }),
      ],
    });

    const { data, error } = await harness.supabase.rpc('import_api_leads_to_campaign', {
      p_account_id: harness.env.accountId,
      p_campaign_id: graph.campaignId,
      p_leads: [
        {
          email,
          first_name: 'Pat',
          tags: ['Hunter.io', 'ICP Fit'],
          email_verification: {
            status: 'ok',
            provider: 'millionverifier',
            is_role: false,
          },
        },
      ],
      p_options: { emit_row_webhooks: false },
    });
    if (isMissingSchema(error)) {
      t.skip('DB-backed test target has not applied lead tags / import metadata; refresh PostgREST schema after migrate');
      return;
    }
    assert.equal(error, null, error?.message);
    const result = data as { created?: number; failed?: number };
    assert.equal(result.failed ?? 0, 0);
    assert.ok((result.created ?? 0) >= 1);

    const { data: assignments, error: assignError } = await harness.supabase
      .from('lead_tag_assignments')
      .select('tag_id')
      .eq('account_id', harness.env.accountId)
      .eq('global_lead_id', globalLeadId);
    if (isMissingSchema(assignError)) {
      t.skip('DB-backed test target has not applied lead_tag_assignments');
      return;
    }
    assert.equal(assignError, null, assignError?.message);
    assert.equal((assignments ?? []).length, 2);

    const { data: facts, error: factsError } = await harness.supabase
      .from('lead_email_facts')
      .select('verification_status, verification_provider, is_role')
      .eq('account_id', harness.env.accountId)
      .eq('global_lead_id', globalLeadId)
      .maybeSingle();
    assert.equal(factsError, null, factsError?.message);
    assert.equal(facts?.verification_status, 'ok');
    assert.equal(facts?.verification_provider, 'millionverifier');
    assert.equal(facts?.is_role, false);

    const tagId = assignments?.[0]?.tag_id;
    assert.ok(tagId);

    const { data: page, error: pageError } = await harness.supabase.rpc('account_lead_people_page', {
      p_account_id: harness.env.accountId,
      p_global_lead_ids: [globalLeadId],
      p_tag_ids: [tagId],
    });
    if (isMissingSchema(pageError)) {
      t.skip('DB-backed test target has not applied people-page p_tag_ids');
      return;
    }
    assert.equal(pageError, null, pageError?.message);
    const rows = (page ?? []) as Array<{ global_lead_id: string }>;
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.global_lead_id, globalLeadId);
  } finally {
    await harness.supabase
      .from('lead_tag_assignments')
      .delete()
      .eq('account_id', harness.env.accountId)
      .eq('global_lead_id', globalLeadId);
    await harness.supabase
      .from('lead_email_facts')
      .delete()
      .eq('account_id', harness.env.accountId)
      .eq('global_lead_id', globalLeadId);
    await harness.cleanup();
  }
});
