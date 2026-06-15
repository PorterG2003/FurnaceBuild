import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { loadFluxProspectPage } from './loadFluxProspectPage';
import type { FluxProspectPageRow } from './types';

function makePage(partial: Partial<FluxProspectPageRow> = {}): FluxProspectPageRow {
  return {
    id: 'page-1',
    prospect_id: 'prospect-1',
    campaign_id: 'campaign-1',
    account_id: 'account-1',
    slug: 'purept',
    page_config: { blocks: [], theme: {}, prospectName: 'Frank', companyName: 'Pure PT' } as never,
    status: 'live',
    created_at: '2026-06-15T00:00:00.000Z',
    updated_at: '2026-06-15T00:00:00.000Z',
    published_at: '2026-06-15T00:00:00.000Z',
    last_viewed_at: null,
    view_count: 0,
    ...partial,
  };
}

function makePageClient(result: FluxProspectPageRow | null) {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    from() {
      calls += 1;
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle: async () => ({ data: result, error: null }),
              };
            },
          };
        },
      };
    },
  };
}

describe('loadFluxProspectPage', () => {
  test('prefers the anonymous client for live public pages', async () => {
    const publicClient = makePageClient(makePage({ status: 'live' }));
    const authenticatedClient = makePageClient(makePage({ status: 'draft' as never }));

    const result = await loadFluxProspectPage('purept', {
      publicClient,
      authenticatedClient,
    });

    assert.equal(result.access, 'public');
    assert.equal(result.page?.status, 'live');
    assert.equal(publicClient.calls, 1);
    assert.equal(authenticatedClient.calls, 0);
  });

  test('falls back to the authenticated client for owner-only draft preview', async () => {
    const publicClient = makePageClient(null);
    const authenticatedClient = makePageClient(makePage({ status: 'draft' as never }));

    const result = await loadFluxProspectPage('purept', {
      publicClient,
      authenticatedClient,
    });

    assert.equal(result.access, 'account');
    assert.equal(result.page?.status, 'draft');
    assert.equal(publicClient.calls, 1);
    assert.equal(authenticatedClient.calls, 1);
  });

  test('returns missing when neither public nor authenticated clients can read the page', async () => {
    const publicClient = makePageClient(null);
    const authenticatedClient = makePageClient(null);

    const result = await loadFluxProspectPage('purept', {
      publicClient,
      authenticatedClient,
    });

    assert.equal(result.page, null);
    assert.equal(result.access, null);
  });
});
