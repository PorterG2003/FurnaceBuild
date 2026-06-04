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
  return `platform-${label}-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 6)}`;
}

function getHarnessClients() {
  loadSeedEnv();

  const supabaseUrl = firstNonEmpty(
    process.env.PLATFORM_TEST_SUPABASE_URL,
    process.env.SUPABASE_URL,
    process.env.EXPO_PUBLIC_SUPABASE_URL
  );
  const serviceRoleKey = firstNonEmpty(
    process.env.PLATFORM_TEST_SUPABASE_SERVICE_ROLE_KEY,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    process.env.SUPABASE_SECRET_KEY
  );
  const publishableKey = firstNonEmpty(
    process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    process.env.SUPABASE_ANON_KEY
  );

  if (!supabaseUrl || !serviceRoleKey || !publishableKey) {
    throw new Error('Platform invite outcomes test requires Supabase URL, service role key, and publishable key.');
  }

  const service = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as DbClient;
  const anon = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as DbClient;
  return { service, anon };
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

async function assertPlatformSchemaAvailable(service: DbClient): Promise<void> {
  const { data, error } = await service
    .from('platform_terms_versions')
    .select('version')
    .limit(1);

  if (
    error &&
    (error.message.includes('relation "public.platform_terms_versions" does not exist') ||
      error.code === 'PGRST205')
  ) {
    throw new Error('SKIP_PLATFORM_SCHEMA_MISSING');
  }

  if (error) throw new Error(error.message);
  void data;
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

test('platform invite flow creates invitation and exposes public invite info', async (t) => {
  const namespace = createPlatformTestNamespace('create');
  const { service, anon } = getHarnessClients();
  const supabaseUrl = process.env.PLATFORM_TEST_SUPABASE_URL || process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL!;
  const adminEmail = `${namespace}-admin@furnace.test`;
  const adminPassword = `Admin!${namespace.slice(-6)}Aa1`;
  const cleanup = {
    platformInvitationIds: [] as string[],
    userIds: [] as string[],
  };

  try {
    try {
      await assertPlatformSchemaAvailable(service);
    } catch (err) {
      if (err instanceof Error && err.message === 'SKIP_PLATFORM_SCHEMA_MISSING') {
        t.skip('Platform invite schema is not present in the current test database.');
      }
      throw err;
    }

    const { data: adminUserData, error: adminCreateError } = await service.auth.admin.createUser({
      email: adminEmail,
      password: adminPassword,
      email_confirm: true,
    });
    if (adminCreateError || !adminUserData.user) {
      throw new Error(adminCreateError?.message ?? 'Failed to create admin auth user');
    }
    cleanup.userIds.push(adminUserData.user.id);
    await waitForPublicUser(service, adminUserData.user.id);
    const { error: flagError } = await service.from('user_access_flags').insert({
      user_id: adminUserData.user.id,
      flag_key: 'platform_admin',
    });
    assert.equal(flagError, null);

    const adminToken = await signIn(anon, adminEmail, adminPassword);
    const adminClient = createClient(supabaseUrl, process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${adminToken}` } },
    }) as DbClient;

    const { data: invitation, error: invitationError } = await adminClient.rpc('create_platform_invitation', {
      p_email: `${namespace}@example.com`,
      p_proposed_account_name: 'Test Workspace',
      p_monthly_retainer_cents: 180000,
      p_currency: 'usd',
      p_proposal_snapshot_json: {
        proposal_title: 'Managed outreach with Furnace',
        proposal_summary: 'Proposal summary',
      },
      p_terms_version: 'default-v1',
      p_agreement_type: 'platform_agreement',
      p_terms_source_markdown: '# Furnace Platform Agreement',
      p_auto_add_internal_admins: true,
      p_expires_at: null,
    });
    assert.equal(invitationError, null);
    assert.ok(invitation?.id);
    cleanup.platformInvitationIds.push(invitation.id);

    const { data: storedInvitation, error: storedInvitationError } = await service
      .from('platform_invitations')
      .select('agreement_type, terms_source_markdown, terms_snapshot_markdown')
      .eq('id', invitation.id)
      .maybeSingle();
    const canAssertTemplateFields =
      storedInvitationError == null ||
      !(
        (storedInvitationError.code === 'PGRST204' || storedInvitationError.code === '42703') &&
        storedInvitationError.message.includes('agreement_type')
      );
    if (canAssertTemplateFields) {
      assert.equal(storedInvitationError, null);
      assert.equal(storedInvitation?.agreement_type, 'platform_agreement');
      assert.ok(storedInvitation?.terms_source_markdown?.includes('# Furnace Platform Agreement'));
      assert.ok(storedInvitation?.terms_snapshot_markdown?.includes('# Furnace Platform Agreement'));
    } else {
      t.diagnostic('Skipping agreement template assertions because the test database schema is behind the workspace migrations.');
    }

    const { error: routeUpdateError } = await service
      .from('platform_invitations')
      .update({
        selected_payment_route: 'card',
        selected_payment_route_fee_cents: 5250,
        selected_payment_subtotal_cents: 180000,
        selected_payment_total_cents: 185250,
        recurring_anchor_at: '2026-06-01T07:00:00.000Z',
        first_recurring_invoice_target_cents: 98814,
      })
      .eq('id', invitation.id);
    const canAssertPaymentRouteFields =
      routeUpdateError == null ||
      !(
        routeUpdateError.code === 'PGRST204' &&
        (
          routeUpdateError.message.includes('selected_payment_route') ||
          routeUpdateError.message.includes('recurring_anchor_at') ||
          routeUpdateError.message.includes('first_recurring_invoice_target_cents')
        )
      );
    if (canAssertPaymentRouteFields) {
      assert.equal(routeUpdateError, null);
    } else {
      t.diagnostic('Skipping payment route persistence assertions because the test database schema is behind the workspace migrations.');
    }

    const { data: publicInfo, error: publicInfoError } = await anon.rpc('get_platform_invitation_info', {
      p_invitation_id: invitation.id,
    });
    assert.equal(publicInfoError, null);
    assert.equal(publicInfo.status, (await revisionRpcsAvailable(service)) ? 'sent' : 'pending');
    assert.equal(publicInfo.invitee_email, `${namespace}@example.com`);
    assert.equal(publicInfo.proposed_account_name, 'Test Workspace');
    if (canAssertTemplateFields) {
      assert.equal(publicInfo.agreement_type, 'platform_agreement');
      assert.ok(publicInfo.terms_source_markdown.includes('# Furnace Platform Agreement'));
    }
    if (canAssertPaymentRouteFields) {
      assert.equal(publicInfo.selected_payment_route, 'card');
      assert.equal(publicInfo.selected_payment_route_fee_cents, 5250);
      assert.equal(publicInfo.selected_payment_total_cents, 185250);
      assert.equal(new Date(publicInfo.recurring_anchor_at).toISOString(), '2026-06-01T07:00:00.000Z');
      assert.equal(publicInfo.first_recurring_invoice_target_cents, 98814);
    }
  } finally {
    if (cleanup.platformInvitationIds.length > 0) {
      await service.from('platform_invitations').delete().in('id', cleanup.platformInvitationIds);
    }
    if (cleanup.userIds.length > 0) {
      await service.from('user_access_flags').delete().in('user_id', cleanup.userIds);
      await service.from('users').delete().in('id', cleanup.userIds);
      for (const userId of cleanup.userIds) {
        await service.auth.admin.deleteUser(userId);
      }
    }
  }
});

test('platform invite completion provisions owner account and internal admins idempotently', async (t) => {
  const namespace = createPlatformTestNamespace('complete');
  const { service, anon } = getHarnessClients();
  const supabaseUrl = process.env.PLATFORM_TEST_SUPABASE_URL || process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL!;
  const adminEmail = `${namespace}-admin@furnace.test`;
  const adminPassword = `Admin!${namespace.slice(-6)}Bb1`;
  const inviteeEmail = `${namespace}@example.com`;
  const inviteePassword = `Invitee!${namespace.slice(-6)}Cc1`;
  const internalEmails = [`porter-${namespace}@getfurnace.io`, `kyle-${namespace}@getfurnace.io`];
  const cleanup = {
    accountIds: [] as string[],
    invitationIds: [] as string[],
    userIds: [] as string[],
  };

  try {
    try {
      await assertPlatformSchemaAvailable(service);
    } catch (err) {
      if (err instanceof Error && err.message === 'SKIP_PLATFORM_SCHEMA_MISSING') {
        t.skip('Platform invite schema is not present in the current test database.');
      }
      throw err;
    }

    const { data: adminUserData } = await service.auth.admin.createUser({
      email: adminEmail,
      password: adminPassword,
      email_confirm: true,
    });
    const adminUserId = adminUserData.user!.id;
    cleanup.userIds.push(adminUserId);
    await waitForPublicUser(service, adminUserId);
    await service.from('user_access_flags').insert({ user_id: adminUserId, flag_key: 'platform_admin' });

    const { data: inviteeUserData } = await service.auth.admin.createUser({
      email: inviteeEmail,
      password: inviteePassword,
      email_confirm: true,
    });
    const inviteeUserId = inviteeUserData.user!.id;
    cleanup.userIds.push(inviteeUserId);
    await waitForPublicUser(service, inviteeUserId);

    for (const email of internalEmails) {
      const { data: internalUserData } = await service.auth.admin.createUser({
        email,
        password: `Internal!${namespace.slice(-6)}Dd1`,
        email_confirm: true,
      });
      cleanup.userIds.push(internalUserData.user!.id);
      await waitForPublicUser(service, internalUserData.user!.id);
    }

    const adminToken = await signIn(anon, adminEmail, adminPassword);
    const adminClient = createClient(supabaseUrl, process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${adminToken}` } },
    }) as DbClient;
    const { data: invitation } = await adminClient.rpc('create_platform_invitation', {
      p_email: inviteeEmail,
      p_proposed_account_name: 'Provisioned Workspace',
      p_monthly_retainer_cents: 180000,
      p_currency: 'usd',
      p_proposal_snapshot_json: { proposal_title: 'Provisioning test' },
      p_terms_version: 'default-v1',
      p_agreement_type: 'platform_agreement',
      p_terms_source_markdown: '# Furnace Platform Agreement',
      p_auto_add_internal_admins: true,
      p_expires_at: null,
    });
    cleanup.invitationIds.push(invitation.id);

    const inviteeToken = await signIn(anon, inviteeEmail, inviteePassword);
    const inviteeClient = createClient(supabaseUrl, process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${inviteeToken}` } },
    }) as DbClient;
    const { data: prepared, error: prepareError } = await inviteeClient.rpc('prepare_platform_invitation_checkout', {
      p_invitation_id: invitation.id,
      p_full_name: 'Invitee Owner',
      p_account_name: 'Provisioned Workspace',
      p_terms_accepted_ip: '127.0.0.1',
    });
    assert.equal(prepareError, null);
    assert.equal(prepared.status, 'pending_payment');

    const { data: pendingPublicInfo, error: pendingPublicInfoError } = await anon.rpc(
      'get_platform_invitation_info',
      {
        p_invitation_id: invitation.id,
      },
    );
    assert.equal(pendingPublicInfoError, null);
    assert.equal(pendingPublicInfo.status, 'pending_payment');

    const { data: pendingInvitationRow, error: pendingInvitationError } = await service
      .from('platform_invitations')
      .select('status, created_account_id')
      .eq('id', invitation.id)
      .maybeSingle();
    assert.equal(pendingInvitationError, null);
    assert.equal(pendingInvitationRow?.status, 'pending_payment');
    assert.equal(pendingInvitationRow?.created_account_id, null);

    const { count: pendingMembershipCount, error: pendingMembershipError } = await service
      .from('account_users')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', inviteeUserId);
    assert.equal(pendingMembershipError, null);
    assert.equal(pendingMembershipCount, 0);

    const { data: completed, error: completeError } = await service.rpc('complete_platform_invitation', {
      p_invitation_id: invitation.id,
      p_stripe_customer_id: `cus_${namespace}`,
      p_stripe_subscription_id: `sub_${namespace}`,
      p_stripe_checkout_session_id: `cs_${namespace}`,
      p_internal_admin_emails: internalEmails,
    });
    assert.equal(completeError, null);
    assert.equal(completed.status, 'completed');
    cleanup.accountIds.push(completed.account_id);

    const { data: activePublicInfo, error: activePublicInfoError } = await anon.rpc(
      'get_platform_invitation_info',
      {
        p_invitation_id: invitation.id,
      },
    );
    assert.equal(activePublicInfoError, null);
    assert.equal(activePublicInfo.status, 'active');

    const { data: billingRow } = await service
      .from('account_billing')
      .select('*')
      .eq('account_id', completed.account_id)
      .single();
    assert.equal(billingRow?.stripe_subscription_id, `sub_${namespace}`);
    assert.equal(billingRow?.billing_status, 'active');

    const { data: memberships } = await service
      .from('account_users')
      .select('user_id, role, is_owner')
      .eq('account_id', completed.account_id);
    const ownerMembership = memberships?.find((row) => row.user_id === inviteeUserId);
    assert.equal(ownerMembership?.role, 'owner');
    assert.equal(ownerMembership?.is_owner, true);
    assert.equal(memberships?.filter((row) => row.role === 'admin').length, 2);

    const { data: repeated, error: repeatedError } = await service.rpc('complete_platform_invitation', {
      p_invitation_id: invitation.id,
      p_stripe_customer_id: `cus_${namespace}`,
      p_stripe_subscription_id: `sub_${namespace}`,
      p_stripe_checkout_session_id: `cs_${namespace}`,
      p_internal_admin_emails: internalEmails,
    });
    assert.equal(repeatedError, null);
    assert.equal(repeated.status, 'already_completed');
    assert.equal(repeated.account_id, completed.account_id);
  } finally {
    if (cleanup.accountIds.length > 0) {
      await service.from('billing_adjustments').delete().in('account_id', cleanup.accountIds);
      await service.from('account_billing').delete().in('account_id', cleanup.accountIds);
      await service.from('account_users').delete().in('account_id', cleanup.accountIds);
      await service.from('accounts').delete().in('id', cleanup.accountIds);
    }
    if (cleanup.invitationIds.length > 0) {
      await service.from('platform_invitations').delete().in('id', cleanup.invitationIds);
    }
    if (cleanup.userIds.length > 0) {
      await service.from('user_access_flags').delete().in('user_id', cleanup.userIds);
      await service.from('users').delete().in('id', cleanup.userIds);
      for (const userId of cleanup.userIds) {
        await service.auth.admin.deleteUser(userId);
      }
    }
  }
});

test('platform invite admin RPCs reject duplicate emails once an account is active', async (t) => {
  const namespace = createPlatformTestNamespace('active-block');
  const { service, anon } = getHarnessClients();
  const supabaseUrl = process.env.PLATFORM_TEST_SUPABASE_URL || process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL!;
  const adminEmail = `${namespace}-admin@furnace.test`;
  const adminPassword = `Admin!${namespace.slice(-6)}Ee1`;
  const inviteeEmail = `${namespace}@example.com`;
  const inviteePassword = `Invitee!${namespace.slice(-6)}Ff1`;
  const cleanup = {
    accountIds: [] as string[],
    invitationIds: [] as string[],
    userIds: [] as string[],
  };

  try {
    try {
      await assertPlatformSchemaAvailable(service);
    } catch (err) {
      if (err instanceof Error && err.message === 'SKIP_PLATFORM_SCHEMA_MISSING') {
        t.skip('Platform invite schema is not present in the current test database.');
      }
      throw err;
    }

    const { data: adminUserData, error: adminCreateError } = await service.auth.admin.createUser({
      email: adminEmail,
      password: adminPassword,
      email_confirm: true,
    });
    if (adminCreateError || !adminUserData.user) {
      throw new Error(adminCreateError?.message ?? 'Failed to create admin auth user');
    }
    cleanup.userIds.push(adminUserData.user.id);
    await waitForPublicUser(service, adminUserData.user.id);
    const { error: flagError } = await service.from('user_access_flags').insert({
      user_id: adminUserData.user.id,
      flag_key: 'platform_admin',
    });
    assert.equal(flagError, null);

    const { data: inviteeUserData, error: inviteeCreateError } = await service.auth.admin.createUser({
      email: inviteeEmail,
      password: inviteePassword,
      email_confirm: true,
    });
    if (inviteeCreateError || !inviteeUserData.user) {
      throw new Error(inviteeCreateError?.message ?? 'Failed to create invitee auth user');
    }
    cleanup.userIds.push(inviteeUserData.user.id);
    await waitForPublicUser(service, inviteeUserData.user.id);

    const adminToken = await signIn(anon, adminEmail, adminPassword);
    const adminClient = createClient(
      supabaseUrl,
      process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY!,
      {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${adminToken}` } },
      },
    ) as DbClient;

    const { data: activeInvite, error: activeInviteError } = await adminClient.rpc('create_platform_invitation', {
      p_email: inviteeEmail,
      p_proposed_account_name: 'Existing Active Workspace',
      p_monthly_retainer_cents: 180000,
      p_currency: 'usd',
      p_proposal_snapshot_json: { proposal_title: 'Existing client' },
      p_terms_version: 'default-v1',
      p_agreement_type: 'platform_agreement',
      p_terms_source_markdown: '# Furnace Platform Agreement',
      p_auto_add_internal_admins: true,
      p_expires_at: null,
    });
    assert.equal(activeInviteError, null);
    cleanup.invitationIds.push(activeInvite.id);

    const inviteeToken = await signIn(anon, inviteeEmail, inviteePassword);
    const inviteeClient = createClient(
      supabaseUrl,
      process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY!,
      {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${inviteeToken}` } },
      },
    ) as DbClient;

    const { data: prepared, error: prepareError } = await inviteeClient.rpc('prepare_platform_invitation_checkout', {
      p_invitation_id: activeInvite.id,
      p_full_name: 'Active Invitee',
      p_account_name: 'Existing Active Workspace',
      p_terms_accepted_ip: '127.0.0.1',
    });
    assert.equal(prepareError, null);
    assert.equal(prepared.status, 'pending_payment');

    const { data: completed, error: completeError } = await service.rpc('complete_platform_invitation', {
      p_invitation_id: activeInvite.id,
      p_stripe_customer_id: `cus_${namespace}`,
      p_stripe_subscription_id: `sub_${namespace}`,
      p_stripe_checkout_session_id: `cs_${namespace}`,
      p_internal_admin_emails: [] as string[],
    });
    assert.equal(completeError, null);
    cleanup.accountIds.push(completed.account_id);

    const { data: duplicateDraft, error: duplicateDraftError } = await adminClient.rpc(
      'create_platform_invitation_draft',
      {
        p_email: inviteeEmail,
        p_proposed_account_name: 'Should Fail',
        p_monthly_retainer_cents: 180000,
        p_currency: 'usd',
        p_proposal_snapshot_json: { proposal_title: 'Duplicate attempt' },
        p_terms_version: 'default-v1',
        p_agreement_type: 'platform_agreement',
        p_terms_source_markdown: '# Furnace Platform Agreement',
        p_auto_add_internal_admins: true,
        p_expires_at: null,
      },
    );
    assert.equal(duplicateDraft, null);
    assert.ok(duplicateDraftError);
    assert.match(
      duplicateDraftError.message,
      /already belongs to an active client account/i,
    );

    const { data: otherDraft, error: otherDraftError } = await adminClient.rpc('create_platform_invitation_draft', {
      p_email: `${namespace}-other@example.com`,
      p_proposed_account_name: 'Another Draft',
      p_monthly_retainer_cents: 180000,
      p_currency: 'usd',
      p_proposal_snapshot_json: { proposal_title: 'Update target' },
      p_terms_version: 'default-v1',
      p_agreement_type: 'platform_agreement',
      p_terms_source_markdown: '# Furnace Platform Agreement',
      p_auto_add_internal_admins: true,
      p_expires_at: null,
    });
    assert.equal(otherDraftError, null);
    cleanup.invitationIds.push(otherDraft.id);

    const { data: duplicateUpdate, error: duplicateUpdateError } = await adminClient.rpc(
      'update_platform_invitation_draft',
      {
        p_invitation_id: otherDraft.id,
        p_email: inviteeEmail,
        p_proposed_account_name: 'Should Also Fail',
        p_monthly_retainer_cents: 180000,
        p_currency: 'usd',
        p_proposal_snapshot_json: { proposal_title: 'Update duplicate attempt' },
        p_terms_version: 'default-v1',
        p_agreement_type: 'platform_agreement',
        p_terms_source_markdown: '# Furnace Platform Agreement',
        p_auto_add_internal_admins: true,
        p_expires_at: null,
      },
    );
    assert.equal(duplicateUpdate, null);
    assert.ok(duplicateUpdateError);
    assert.match(
      duplicateUpdateError.message,
      /already belongs to an active client account/i,
    );
  } finally {
    if (cleanup.accountIds.length > 0) {
      await service.from('billing_adjustments').delete().in('account_id', cleanup.accountIds);
      await service.from('account_billing').delete().in('account_id', cleanup.accountIds);
      await service.from('account_users').delete().in('account_id', cleanup.accountIds);
      await service.from('accounts').delete().in('id', cleanup.accountIds);
    }
    if (cleanup.invitationIds.length > 0) {
      await service.from('platform_invitations').delete().in('id', cleanup.invitationIds);
    }
    if (cleanup.userIds.length > 0) {
      await service.from('user_access_flags').delete().in('user_id', cleanup.userIds);
      await service.from('users').delete().in('id', cleanup.userIds);
      for (const userId of cleanup.userIds) {
        await service.auth.admin.deleteUser(userId);
      }
    }
  }
});
