import test from 'node:test';
import assert from 'node:assert/strict';
import { CampaignDbHarness } from './harness';
import { buildCampaignEnrollment, buildCampaignLead, createCampaignTestNamespace } from './fixtures';

function isBucketLeadFieldCoverageRpcMissing(error: unknown): boolean {
  const message = String((error as { message?: string } | null)?.message ?? '');
  if (!message.includes('bucket_lead_field_coverage')) {
    return false;
  }
  const code = (error as { code?: string } | null)?.code;
  return code === 'PGRST202' || code === 'PGRST203';
}

test('bucket_lead_field_coverage returns bucket-wide fill counts', async (t) => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('bucket-coverage') });
  const emailFull = `full-${harness.namespace}@furnace.test`;
  const emailSparse = `sparse-${harness.namespace}@furnace.test`;

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Bucket Coverage',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'full',
          email: emailFull,
          firstName: 'Full',
          lastName: 'Lead',
          companyName: 'Acme',
          enrollment: buildCampaignEnrollment({ state: 'active' }),
        }),
        buildCampaignLead({
          key: 'sparse',
          email: emailSparse,
          firstName: '',
          lastName: '',
          companyName: '',
          enrollment: buildCampaignEnrollment({ state: 'active' }),
        }),
      ],
    });

    const { data, error } = await harness.supabase.rpc('bucket_lead_field_coverage', {
      p_campaign_id: graph.campaignId,
      p_bucket_id: graph.bucketId,
    });

    if (isBucketLeadFieldCoverageRpcMissing(error)) {
      t.skip(
        'DB-backed test target has not applied bucket_lead_field_coverage migration; refresh PostgREST schema after migrate',
      );
      return;
    }

    assert.equal(error, null);

    const rows = (data ?? []) as Array<{
      field_key: string;
      filled_count: number | string;
      total_count: number | string;
    }>;

    const totalCount = Math.max(...rows.map((row) => Number(row.total_count ?? 0)), 0);
    assert.equal(totalCount, 2);

    const emailStats = rows.find((row) => row.field_key === 'email');
    assert.ok(emailStats);
    assert.equal(Number(emailStats.filled_count), 2);

    const firstNameStats = rows.find((row) => row.field_key === 'first_name');
    assert.ok(firstNameStats);
    assert.equal(Number(firstNameStats.filled_count), 1);

    const companyStats = rows.find((row) => row.field_key === 'company_name');
    assert.ok(companyStats);
    assert.equal(Number(companyStats.filled_count), 1);
  } finally {
    await harness.cleanup();
  }
});
