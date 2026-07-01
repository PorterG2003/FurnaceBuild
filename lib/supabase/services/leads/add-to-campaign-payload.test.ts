import test from 'node:test';
import assert from 'node:assert/strict';
import type { LeadRowByGlobalId } from './fetch-leads-by-global-ids';
import { buildAddToCampaignPayloads, mergeLeadUpdatePatch } from './add-to-campaign-payload';

function buildRow(overrides: Partial<LeadRowByGlobalId> & { id: string; global_lead_id: string }): LeadRowByGlobalId {
  return {
    campaign_id: 'camp-source',
    email: 'person@example.com',
    name: null,
    first_name: 'Pat',
    last_name: 'Lee',
    company_name: 'Acme',
    website: null,
    linkedin_url: null,
    phone_number: null,
    mobile_phone_number: null,
    custom_lead_data: null,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

test('buildAddToCampaignPayloads picks the newest non-target membership for field values', () => {
  const globalLeadId = 'global-1';
  const results = buildAddToCampaignPayloads({
    flowData: { nodes: [{ type: 'leadSource', data: { customFieldKeys: [] } }] },
    globalLeadIds: [globalLeadId],
    targetCampaignId: 'camp-target',
    sourceRows: [
      buildRow({
        id: 'lead-old',
        global_lead_id: globalLeadId,
        campaign_id: 'camp-source',
        created_at: '2026-01-01T00:00:00.000Z',
        company_name: 'Old Co',
      }),
      buildRow({
        id: 'lead-new',
        global_lead_id: globalLeadId,
        campaign_id: 'camp-source',
        created_at: '2026-02-01T00:00:00.000Z',
        company_name: 'New Co',
      }),
      buildRow({
        id: 'lead-target',
        global_lead_id: globalLeadId,
        campaign_id: 'camp-target',
        created_at: '2026-03-01T00:00:00.000Z',
        company_name: 'Target Co',
      }),
    ],
  });

  assert.equal(results.length, 1);
  assert.equal(results[0]?.kind, 'ready');
  if (results[0]?.kind === 'ready') {
    assert.equal(results[0].insertPayload.company_name, 'New Co');
    assert.equal(results[0].email, 'person@example.com');
  }
});

test('buildAddToCampaignPayloads marks rows incomplete when required custom fields are missing', () => {
  const globalLeadId = 'global-2';
  const results = buildAddToCampaignPayloads({
    flowData: { nodes: [{ type: 'leadSource', data: { customFieldKeys: ['tier'] } }] },
    globalLeadIds: [globalLeadId],
    targetCampaignId: 'camp-target',
    sourceRows: [
      buildRow({
        id: 'lead-1',
        global_lead_id: globalLeadId,
        custom_lead_data: {},
      }),
    ],
  });

  assert.equal(results[0]?.kind, 'ready');
  if (results[0]?.kind === 'ready') {
    assert.equal(results[0].incomplete, true);
  }
});

test('mergeLeadUpdatePatch fills only empty standard fields and merges custom_lead_data', () => {
  const patch = mergeLeadUpdatePatch(
    {
      name: 'Existing Name',
      first_name: null,
      last_name: null,
      company_name: null,
      website: null,
      linkedin_url: null,
      phone_number: null,
      mobile_phone_number: null,
      custom_lead_data: { tier: 'gold' },
    },
    {
      email: 'person@example.com',
      name: 'New Name',
      first_name: 'Pat',
      last_name: 'Lee',
      company_name: 'Acme',
      website: 'https://acme.test',
      linkedin_url: null,
      phone_number: '+15551234567',
      mobile_phone_number: '+15557654321',
      global_lead_id: 'global-1',
      source: 'Leads workbench',
      custom_lead_data: { region: 'west' },
    },
  );

  assert.equal(patch.name, undefined);
  assert.equal(patch.first_name, 'Pat');
  assert.equal(patch.company_name, 'Acme');
  assert.equal(patch.phone_number, '+15551234567');
  assert.equal(patch.mobile_phone_number, '+15557654321');
  assert.deepEqual(patch.custom_lead_data, { tier: 'gold', region: 'west' });
});
