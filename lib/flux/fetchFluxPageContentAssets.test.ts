import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { fetchFluxPageContentAssets } from './fetchFluxPageContentAssets';

describe('fetchFluxPageContentAssets', () => {
  test('uses the provided RPC client and trims the slug', async () => {
    const calls: Array<{ fn: string; args: { p_slug: string } }> = [];
    const client = {
      rpc: async (fn: 'flux_resolve_page_content_assets', args: { p_slug: string }) => {
        calls.push({ fn, args });
        return {
          data: [
            {
              id: 'asset-1',
              type: 'case_study',
              title: 'Acme',
              body: 'Grew revenue',
              metric: '2x',
              imageUrl: 'https://cdn.example/acme.png',
            },
          ],
          error: null,
        };
      },
    };

    const assets = await fetchFluxPageContentAssets(' purept ', client);

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], {
      fn: 'flux_resolve_page_content_assets',
      args: { p_slug: 'purept' },
    });
    assert.equal(assets.length, 1);
    assert.equal(assets[0]?.id, 'asset-1');
  });

  test('returns an empty array for blank slugs', async () => {
    const client = {
      rpc: async () => {
        throw new Error('should not be called');
      },
    };

    const assets = await fetchFluxPageContentAssets('   ', client);
    assert.deepEqual(assets, []);
  });
});
