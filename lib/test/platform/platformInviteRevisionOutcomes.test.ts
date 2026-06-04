import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { createClient } from '@supabase/supabase-js';
import { loadSeedEnv } from '../../../scripts/seed/env';

type DbClient = ReturnType<typeof createClient>;

function firstNonEmpty(...values: Array<string | undefined | null>): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function createPlatformTestNamespace(label: string): string {
  return `platform-revision-${label}-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 6)}`;
}

function getHarnessClients() {
  loadSeedEnv();

  const supabaseUrl = firstNonEmpty(
    process.env.PLATFORM_TEST_SUPABASE_URL,
    process.env.SUPABASE_URL,
    process.env.EXPO_PUBLIC_SUPABASE_URL,
  );
  const serviceRoleKey = firstNonEmpty(
    process.env.PLATFORM_TEST_SUPABASE_SERVICE_ROLE_KEY,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    process.env.SUPABASE_SECRET_KEY,
  );
  const publishableKey = firstNonEmpty(
    process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    process.env.SUPABASE_ANON_KEY,
  );

  if (!supabaseUrl || !serviceRoleKey || !publishableKey) {
    throw new Error('Platform revision tests require Supabase URL, service role key, and publishable key.');
  }

  const service = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as DbClient;
  const anon = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as DbClient;
  return { service, anon, supabaseUrl, publishableKey };
}

async function waitForPublicUser(service: DbClient, userId: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const { data } = await service.from('users').select('id').eq('id', userId).maybeSingle();
    if (data) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for public.users row ${userId}`);
}

async function signIn(anon: DbClient, email: string, password: string) {
  const { data, error } = await anon.auth.signInWithPassword({ email, password });
  if (error || !data.session?.access_token) {
    throw new Error(`Failed to sign in ${email}: ${error?.message ?? 'missing session'}`);
  }
  return data.session.access_token;
}

async function revisionRpcsAvailable(service: DbClient): Promise<boolean> {
  const { error } = await service.rpc('unpublish_platform_invitation', {
    p_invitation_id: '00000000-0000-0000-0000-000000000000',
  });
  if (
    error &&
    (error.message.includes('Could not find the function') ||
      error.code === 'PGRST202' ||
      error.message.includes('does not exist'))
  ) {
    return false;
  }
  return true;
}

async function createPlatformAdminClient(namespace: string) {
  const { service, anon, supabaseUrl, publishableKey } = getHarnessClients();
  const adminEmail = `${namespace}-admin@furnace.test`;
  const adminPassword = `Admin!${namespace.slice(-6)}Aa1`;

  const { data: adminUserData, error: adminCreateError } = await service.auth.admin.createUser({
    email: adminEmail,
    password: adminPassword,
    email_confirm: true,
  });
  if (adminCreateError || !adminUserData.user) {
    throw new Error(adminCreateError?.message ?? 'Failed to create admin auth user');
  }

  await waitForPublicUser(service, adminUserData.user.id);
  await service.from('user_access_flags').insert({
    user_id: adminUserData.user.id,
    flag_key: 'platform_admin',
  });

  const adminToken = await signIn(anon, adminEmail, adminPassword);
  const adminClient = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${adminToken}` } },
  }) as DbClient;

  return {
    service,
    anon,
    adminClient,
    cleanupUserIds: [adminUserData.user.id],
  };
}

const draftParams = (email: string, retainerCents: number, title: string) => ({
  p_email: email,
  p_proposed_account_name: 'Revision Test Workspace',
  p_monthly_retainer_cents: retainerCents,
  p_currency: 'usd',
  p_proposal_snapshot_json: { proposal_title: title },
  p_terms_version: 'default-v1',
  p_agreement_type: 'platform_agreement',
  p_terms_source_markdown: '# Furnace Platform Agreement',
  p_auto_add_internal_admins: true,
  p_expires_at: null,
});

test('platform invite revision flow preserves published client view until republish', async (t) => {
  const namespace = createPlatformTestNamespace('publish-drift');
  const cleanup = {
    platformInvitationIds: [] as string[],
    userIds: [] as string[],
  };
  let service: DbClient | null = null;

  try {
    const harness = await createPlatformAdminClient(namespace);
    service = harness.service;
    const { anon, adminClient, cleanupUserIds } = harness;
    cleanup.userIds.push(...cleanupUserIds);

    if (!(await revisionRpcsAvailable(service))) {
      t.skip('Platform revision RPCs are not present in the current test database.');
      return;
    }

    const inviteeEmail = `${namespace}@example.com`;
    const { data: draft, error: draftError } = await adminClient.rpc(
      'create_platform_invitation_draft',
      draftParams(inviteeEmail, 180000, 'Revision v1'),
    );
    assert.equal(draftError, null);
    cleanup.platformInvitationIds.push(draft.id);

    const { data: published, error: publishError } = await adminClient.rpc('publish_platform_invitation', {
      p_invitation_id: draft.id,
    });
    assert.equal(publishError, null);
    assert.equal(published.current_revision_number, 1);
    assert.equal(published.published_revision_number, 1);
    assert.equal(published.status, 'sent');

    const { data: publicV1, error: publicV1Error } = await anon.rpc('get_platform_invitation_info', {
      p_invitation_id: draft.id,
    });
    assert.equal(publicV1Error, null);
    assert.equal(publicV1.status, 'sent');
    assert.equal(publicV1.monthly_retainer_cents, 180000);

    const { data: updated, error: updateError } = await adminClient.rpc(
      'update_platform_invitation_draft',
      {
        p_invitation_id: draft.id,
        ...draftParams(inviteeEmail, 200000, 'Revision v2'),
      },
    );
    assert.equal(updateError, null);
    assert.equal(updated.current_revision_number, 2);
    assert.equal(updated.published_revision_number, 1);
    assert.equal(updated.status, 'sent');

    const { data: publicStillV1, error: publicStillV1Error } = await anon.rpc('get_platform_invitation_info', {
      p_invitation_id: draft.id,
    });
    assert.equal(publicStillV1Error, null);
    assert.equal(publicStillV1.monthly_retainer_cents, 180000);

    const { data: republished, error: republishError } = await adminClient.rpc('publish_platform_invitation', {
      p_invitation_id: draft.id,
    });
    assert.equal(republishError, null);
    assert.equal(republished.published_revision_number, 2);

    const { data: publicV2, error: publicV2Error } = await anon.rpc('get_platform_invitation_info', {
      p_invitation_id: draft.id,
    });
    assert.equal(publicV2Error, null);
    assert.equal(publicV2.monthly_retainer_cents, 200000);
  } finally {
    if (service && cleanup.platformInvitationIds.length > 0) {
      await service.from('platform_invitations').delete().in('id', cleanup.platformInvitationIds);
    }
    if (service && cleanup.userIds.length > 0) {
      await service.from('user_access_flags').delete().in('user_id', cleanup.userIds);
      await service.from('users').delete().in('id', cleanup.userIds);
      for (const userId of cleanup.userIds) {
        await service.auth.admin.deleteUser(userId);
      }
    }
  }
});

test('platform invite unpublish and restore revision actions behave as expected', async (t) => {
  const namespace = createPlatformTestNamespace('unpublish-restore');
  const cleanup = {
    platformInvitationIds: [] as string[],
    userIds: [] as string[],
  };
  let service: DbClient | null = null;

  try {
    const harness = await createPlatformAdminClient(namespace);
    service = harness.service;
    const { anon, adminClient, cleanupUserIds } = harness;
    cleanup.userIds.push(...cleanupUserIds);

    if (!(await revisionRpcsAvailable(service))) {
      t.skip('Platform revision RPCs are not present in the current test database.');
      return;
    }

    const inviteeEmail = `${namespace}@example.com`;
    const inviteePassword = `Invitee!${namespace.slice(-6)}Bb1`;
    const { data: inviteeUserData } = await service.auth.admin.createUser({
      email: inviteeEmail,
      password: inviteePassword,
      email_confirm: true,
    });
    cleanup.userIds.push(inviteeUserData.user!.id);
    await waitForPublicUser(service, inviteeUserData.user!.id);

    const { data: draft, error: draftError } = await adminClient.rpc(
      'create_platform_invitation_draft',
      draftParams(inviteeEmail, 180000, 'Restore source'),
    );
    assert.equal(draftError, null);
    cleanup.platformInvitationIds.push(draft.id);

    await adminClient.rpc('publish_platform_invitation', { p_invitation_id: draft.id });
    await adminClient.rpc('update_platform_invitation_draft', {
      p_invitation_id: draft.id,
      ...draftParams(inviteeEmail, 220000, 'Restore target'),
    });

    const { data: restored, error: restoreError } = await adminClient.rpc(
      'restore_platform_invitation_revision',
      {
        p_invitation_id: draft.id,
        p_revision_number: 1,
      },
    );
    assert.equal(restoreError, null);
    assert.equal(restored.current_revision_number, 3);
    assert.equal(restored.published_revision_number, 1);
    assert.equal(restored.monthly_retainer_cents, 180000);

    const { data: publicStillPublished, error: publicStillPublishedError } = await anon.rpc(
      'get_platform_invitation_info',
      { p_invitation_id: draft.id },
    );
    assert.equal(publicStillPublishedError, null);
    assert.equal(publicStillPublished.monthly_retainer_cents, 180000);

    const { data: unpublished, error: unpublishError } = await adminClient.rpc(
      'unpublish_platform_invitation',
      { p_invitation_id: draft.id },
    );
    assert.equal(unpublishError, null);
    assert.equal(unpublished.published_revision_number, null);
    assert.equal(unpublished.status, 'draft');

    const { data: offlineInfo, error: offlineInfoError } = await anon.rpc('get_platform_invitation_info', {
      p_invitation_id: draft.id,
    });
    assert.equal(offlineInfoError, null);
    assert.equal(offlineInfo.status, 'not_found');

    const inviteeToken = await signIn(anon, inviteeEmail, inviteePassword);
    const inviteeClient = createClient(
      process.env.PLATFORM_TEST_SUPABASE_URL ||
        process.env.SUPABASE_URL ||
        process.env.EXPO_PUBLIC_SUPABASE_URL!,
      process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY!,
      {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${inviteeToken}` } },
      },
    ) as DbClient;

    await adminClient.rpc('publish_platform_invitation', { p_invitation_id: draft.id });
    const { data: prepared, error: prepareError } = await inviteeClient.rpc(
      'prepare_platform_invitation_checkout',
      {
        p_invitation_id: draft.id,
        p_full_name: 'Revision Guard',
        p_account_name: 'Revision Test Workspace',
        p_terms_accepted_ip: '127.0.0.1',
      },
    );
    assert.equal(prepareError, null);
    assert.equal(prepared.status, 'pending_payment');

    const { data: blockedUnpublish, error: blockedUnpublishError } = await adminClient.rpc(
      'unpublish_platform_invitation',
      { p_invitation_id: draft.id },
    );
    assert.equal(blockedUnpublish, null);
    assert.ok(blockedUnpublishError);

    const { data: blockedRestore, error: blockedRestoreError } = await adminClient.rpc(
      'restore_platform_invitation_revision',
      {
        p_invitation_id: draft.id,
        p_revision_number: 1,
      },
    );
    assert.equal(blockedRestore, null);
    assert.ok(blockedRestoreError);
  } finally {
    if (service && cleanup.platformInvitationIds.length > 0) {
      await service.from('platform_invitations').delete().in('id', cleanup.platformInvitationIds);
    }
    if (service && cleanup.userIds.length > 0) {
      await service.from('user_access_flags').delete().in('user_id', cleanup.userIds);
      await service.from('users').delete().in('id', cleanup.userIds);
      for (const userId of cleanup.userIds) {
        await service.auth.admin.deleteUser(userId);
      }
    }
  }
});
