import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { revokeUserSession } from '../../mcp/session.js';
import { ClientApiDbHarness, createClientApiTestNamespace } from './harness.js';

test('mcp user session scopes reads/writes by X-Furnace-Account-Id and fails closed', async () => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('mcp-user-auth'),
  });

  try {
    await harness.ensureOwnerAuthUser();
    const accountB = await harness.createSecondAccount();
    const session = await harness.issueMcpSession({
      userId: harness.ownerUserId,
      allowedAccountIds: [harness.accountId, accountB],
    });
    const apiKey = await harness.createApiKey('mcp-parity-key');

    // [O8] missing account header
    {
      const res = await harness.requestAsUser('/v1/campaigns', {
        token: session.accessToken,
        method: 'GET',
      });
      assert.equal(res.status, 400);
    }

    // [O1,O4] account-scoped list on A
    {
      const res = await harness.requestAsUser('/v1/campaigns', {
        token: session.accessToken,
        accountId: harness.accountId,
        method: 'GET',
      });
      assert.equal(res.status, 200, await res.text());
    }

    // [O6,O7] not in grant
    {
      const res = await harness.requestAsUser('/v1/campaigns', {
        token: session.accessToken,
        accountId: crypto.randomUUID(),
        method: 'GET',
      });
      assert.equal(res.status, 403);
    }

    // [O5] membership removed on granted account B
    {
      await harness.supabase
        .from('account_users')
        .delete()
        .eq('account_id', accountB)
        .eq('user_id', harness.ownerUserId);
      const res = await harness.requestAsUser('/v1/campaigns', {
        token: session.accessToken,
        accountId: accountB,
        method: 'GET',
      });
      assert.equal(res.status, 403);
      await harness.supabase.from('account_users').insert({
        id: crypto.randomUUID(),
        account_id: accountB,
        user_id: harness.ownerUserId,
        is_owner: true,
        role: 'owner',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as never);
    }

    // [O9] revoked
    {
      const ephemeral = await harness.issueMcpSession({
        userId: harness.ownerUserId,
        allowedAccountIds: [harness.accountId],
      });
      await revokeUserSession({
        sessionId: ephemeral.sessionId,
        userId: harness.ownerUserId,
        supabase: harness.supabase,
      });
      const res = await harness.requestAsUser('/v1/campaigns', {
        token: ephemeral.accessToken,
        accountId: harness.accountId,
        method: 'GET',
      });
      assert.equal(res.status, 401);
    }

    // [O9] expired
    {
      const expired = await harness.issueMcpSession({
        userId: harness.ownerUserId,
        allowedAccountIds: [harness.accountId],
        expiresAt: new Date(Date.now() - 60_000),
      });
      const res = await harness.requestAsUser('/v1/campaigns', {
        token: expired.accessToken,
        accountId: harness.accountId,
        method: 'GET',
      });
      assert.equal(res.status, 401);
    }

    // [O24] f_ ignores spoofed header
    {
      const res = await harness.request('/v1/campaigns', {
        apiKey: apiKey.secret,
        method: 'GET',
        headers: { 'X-Furnace-Account-Id': accountB },
      });
      assert.equal(res.status, 200);
    }

    // [O19] no Furnace MCP keys minted
    {
      const { count, error } = await harness.supabase
        .from('account_api_keys')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', harness.accountId)
        .gte('created_at', harness.startedAt)
        .like('name', 'Furnace MCP%');
      assert.equal(error, null);
      assert.equal(count ?? 0, 0);
    }

    // [O27] session list safe fields
    {
      const res = await harness.requestAsOwner('/internal/mcp/sessions');
      const body = (await res.json()) as { data?: Array<Record<string, unknown>> };
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(body.data));
      const mine = body.data!.find((s) => s.id === session.sessionId);
      assert.ok(mine);
      assert.ok(!('token_hash' in mine!));
      assert.ok(!('refresh_token_hash' in mine!));
    }
  } finally {
    await harness.cleanup();
  }
});
