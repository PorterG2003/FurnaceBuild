import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DEFAULT_SAVED_LIST_COLUMNS } from '@/lib/leads/columns/defaults';
import { CampaignDbHarness } from '../campaign/harness';
import { buildCampaignEnrollment, buildCampaignLead, createCampaignTestNamespace } from '../campaign/fixtures';

function hashGlobalLeadId(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}

test('saved_lead_list_people_page sort and search within list membership', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('saved-list-page') });
  let listId: string | null = null;

  try {
    const emails = ['aaa', 'bbb', 'ccc'].map(
      (prefix) => `${prefix}-saved-list-${harness.namespace}@furnace.test`,
    );
    await harness.createCampaignGraph({
      name: 'Saved List Page Campaign',
      status: 'running',
      flowKind: 'emailOnly',
      leads: emails.map((email, index) =>
        buildCampaignLead({
          key: `lead-${index}`,
          email,
          enrollment: buildCampaignEnrollment({ state: 'active' }),
        }),
      ),
    });

    for (const email of emails) {
      await harness.supabase.rpc('backfill_account_lead_people_batch', {
        p_account_id: harness.env.accountId,
        p_limit: 500,
      });
      void email;
    }

    const globalLeadIds = emails.map((email) => hashGlobalLeadId(email));

    const { data: listRow, error: listError } = await harness.supabase
      .from('lead_saved_lists')
      .insert({
        account_id: harness.env.accountId,
        name: `Test list ${harness.namespace}`,
        description: null,
        column_layout: DEFAULT_SAVED_LIST_COLUMNS as never,
      })
      .select('id')
      .single();

    assert.equal(listError, null);
    listId = listRow!.id as string;

    const { error: membersError } = await harness.supabase.from('lead_saved_list_members').insert(
      globalLeadIds.map((globalLeadId) => ({
        list_id: listId!,
        account_id: harness.env.accountId,
        global_lead_id: globalLeadId,
        source: 'selection' as const,
      })),
    );
    assert.equal(membersError, null);

    const { data: sortedAsc, error: sortError } = await harness.supabase.rpc('saved_lead_list_people_page', {
      p_account_id: harness.env.accountId,
      p_list_id: listId,
      p_limit: 10,
      p_offset: 0,
      p_sort_column: 'person-email',
      p_sort_direction: 'asc',
    });
    assert.equal(sortError, null);
    assert.equal((sortedAsc ?? []).length, 3);
    assert.equal((sortedAsc?.[0] as { email: string }).email, emails[0]);
    assert.equal((sortedAsc?.[2] as { email: string }).email, emails[2]);

    const { data: searched, error: searchError } = await harness.supabase.rpc('saved_lead_list_people_page', {
      p_account_id: harness.env.accountId,
      p_list_id: listId,
      p_search: 'bbb-saved-list',
      p_limit: 10,
      p_offset: 0,
    });
    assert.equal(searchError, null);
    assert.equal((searched ?? []).length, 1);
    assert.equal((searched?.[0] as { email: string }).email, emails[1]);
    assert.equal((searched?.[0] as { total_count: number }).total_count, 1);
  } finally {
    if (listId) {
      await harness.supabase.from('lead_saved_list_members').delete().eq('list_id', listId);
      await harness.supabase.from('lead_saved_lists').delete().eq('id', listId);
    }
    await harness.cleanup();
  }
});
