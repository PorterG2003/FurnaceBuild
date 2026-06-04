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
  return `platform-amendment-${label}-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 6)}`;
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
    throw new Error('Platform amendment tests require Supabase URL, service role key, and publishable key.');
  }

  const service = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as DbClient;
  const anon = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as DbClient;
  return { service, anon };
}

async function amendmentRpcsAvailable(service: DbClient): Promise<boolean> {
  const { error } = await service.rpc('create_platform_account_amendment_draft', {
    p_account_id: '00000000-0000-0000-0000-000000000000',
    p_account_name: 'Test',
    p_monthly_retainer_cents: 100_000,
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

test('account amendment publish and owner accept (terms only)', async (t) => {
  const namespace = createPlatformTestNamespace('accept');
  const { service, anon } = getHarnessClients();
  const adminEmail = `${namespace}-admin@furnace.test`;
  const ownerEmail = `${namespace}-owner@furnace.test`;
  const adminPassword = `Admin!${namespace.slice(-6)}Aa1`;
  const ownerPassword = `Owner!${namespace.slice(-6)}Bb2`;
  const cleanup = {
    accountIds: [] as string[],
    amendmentIds: [] as string[],
    userIds: [] as string[],
  };

  try {
    if (!(await amendmentRpcsAvailable(service))) {
      t.skip('Account amendment RPCs are not present in the current test database.');
    }

    const { data: adminAuth, error: adminAuthError } = await service.auth.admin.createUser({
      email: adminEmail,
      password: adminPassword,
      email_confirm: true,
    });
    if (adminAuthError || !adminAuth.user) throw new Error(adminAuthError?.message ?? 'admin user');
    cleanup.userIds.push(adminAuth.user.id);
    await waitForPublicUser(service, adminAuth.user.id);

    await service.from('user_access_flags').upsert({
      user_id: adminAuth.user.id,
      flag_key: 'platform_admin',
    });

    const { data: ownerAuth, error: ownerAuthError } = await service.auth.admin.createUser({
      email: ownerEmail,
      password: ownerPassword,
      email_confirm: true,
    });
    if (ownerAuthError || !ownerAuth.user) throw new Error(ownerAuthError?.message ?? 'owner user');
    cleanup.userIds.push(ownerAuth.user.id);
    await waitForPublicUser(service, ownerAuth.user.id);

    const { data: account, error: accountError } = await service
      .from('accounts')
      .insert({ name: `${namespace} Account` })
      .select('id')
      .single();
    if (accountError || !account) throw new Error(accountError?.message ?? 'account');
    cleanup.accountIds.push(account.id);

    await service.from('account_users').insert({
      account_id: account.id,
      user_id: ownerAuth.user.id,
      is_owner: true,
      role: 'owner',
    });

    await service.from('account_billing').insert({
      account_id: account.id,
      monthly_retainer_cents: 300_000,
      billing_status: 'active',
      agreement_type: 'platform_agreement',
      proposal_snapshot_json: { proposal_title: 'Furnace Platform Access' },
      terms_version: 'platform-agreement-current',
      terms_snapshot_markdown: '# Terms',
    });

    const adminToken = await signIn(anon, adminEmail, adminPassword);
    const adminClient = createClient(
      process.env.PLATFORM_TEST_SUPABASE_URL ||
        process.env.SUPABASE_URL ||
        process.env.EXPO_PUBLIC_SUPABASE_URL!,
      process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY!,
      {
        global: { headers: { Authorization: `Bearer ${adminToken}` } },
        auth: { persistSession: false, autoRefreshToken: false },
      },
    ) as DbClient;

    const { data: amendment, error: draftError } = await adminClient.rpc(
      'create_platform_account_amendment_draft',
      {
        p_account_id: account.id,
        p_account_name: `${namespace} Account`,
        p_monthly_retainer_cents: 300_000,
        p_agreement_type: 'platform_agreement',
      },
    );
    if (draftError) throw new Error(draftError.message);
    cleanup.amendmentIds.push(amendment.id);

    const { error: publishError } = await adminClient.rpc('publish_platform_account_amendment', {
      p_amendment_id: amendment.id,
    });
    if (publishError) throw new Error(publishError.message);

    const ownerToken = await signIn(anon, ownerEmail, ownerPassword);
    const ownerClient = createClient(
      process.env.PLATFORM_TEST_SUPABASE_URL ||
        process.env.SUPABASE_URL ||
        process.env.EXPO_PUBLIC_SUPABASE_URL!,
      process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY!,
      {
        global: { headers: { Authorization: `Bearer ${ownerToken}` } },
        auth: { persistSession: false, autoRefreshToken: false },
      },
    ) as DbClient;

    const { data: pending, error: pendingError } = await ownerClient.rpc(
      'get_pending_platform_account_amendment',
      { p_account_id: account.id },
    );
    if (pendingError) throw new Error(pendingError.message);
    assert.equal(pending?.amendment_id, amendment.id);

    const { data: acceptResult, error: acceptError } = await ownerClient.rpc(
      'accept_platform_account_amendment',
      { p_amendment_id: amendment.id },
    );
    if (acceptError) throw new Error(acceptError.message);
    assert.equal(acceptResult.billing_change_kind, 'unchanged');
    assert.equal(acceptResult.requires_stripe_apply, false);

    const { data: billing, error: billingError } = await service
      .from('account_billing')
      .select('accepted_amendment_id, terms_snapshot_markdown')
      .eq('account_id', account.id)
      .single();
    if (billingError) throw new Error(billingError.message);
    assert.equal(billing.accepted_amendment_id, amendment.id);
  } finally {
    for (const amendmentId of cleanup.amendmentIds) {
      await service.from('platform_account_amendment_revisions').delete().eq('amendment_id', amendmentId);
      await service.from('platform_account_amendments').delete().eq('id', amendmentId);
    }
    for (const accountId of cleanup.accountIds) {
      await service.from('account_billing_changes').delete().eq('account_id', accountId);
      await service.from('account_billing').delete().eq('account_id', accountId);
      await service.from('account_users').delete().eq('account_id', accountId);
      await service.from('accounts').delete().eq('id', accountId);
    }
    for (const userId of cleanup.userIds) {
      await service.from('user_access_flags').delete().eq('user_id', userId);
      await service.auth.admin.deleteUser(userId);
    }
  }
});

test('account amendment accept with downgrade schedules retainer', async (t) => {
  const namespace = createPlatformTestNamespace('downgrade');
  const { service, anon } = getHarnessClients();
  const ownerEmail = `${namespace}-owner@furnace.test`;
  const adminEmail = `${namespace}-admin@furnace.test`;
  const ownerPassword = `Owner!${namespace.slice(-6)}Bb2`;
  const adminPassword = `Admin!${namespace.slice(-6)}Aa1`;
  const cleanup = {
    accountIds: [] as string[],
    amendmentIds: [] as string[],
    userIds: [] as string[],
  };

  try {
    if (!(await amendmentRpcsAvailable(service))) {
      t.skip('Account amendment RPCs are not present in the current test database.');
    }

    const { data: adminAuth } = await service.auth.admin.createUser({
      email: adminEmail,
      password: adminPassword,
      email_confirm: true,
    });
    if (!adminAuth.user) throw new Error('admin');
    cleanup.userIds.push(adminAuth.user.id);
    await waitForPublicUser(service, adminAuth.user.id);
    await service.from('user_access_flags').upsert({
      user_id: adminAuth.user.id,
      flag_key: 'platform_admin',
    });

    const { data: ownerAuth } = await service.auth.admin.createUser({
      email: ownerEmail,
      password: ownerPassword,
      email_confirm: true,
    });
    if (!ownerAuth.user) throw new Error('owner');
    cleanup.userIds.push(ownerAuth.user.id);
    await waitForPublicUser(service, ownerAuth.user.id);

    const { data: account } = await service
      .from('accounts')
      .insert({ name: `${namespace} Account` })
      .select('id')
      .single();
    if (!account) throw new Error('account');
    cleanup.accountIds.push(account.id);

    await service.from('account_users').insert({
      account_id: account.id,
      user_id: ownerAuth.user.id,
      is_owner: true,
      role: 'owner',
    });

    await service.from('account_billing').insert({
      account_id: account.id,
      monthly_retainer_cents: 500_000,
      billing_status: 'active',
      agreement_type: 'platform_agreement',
      proposal_snapshot_json: {},
      terms_version: 'platform-agreement-current',
      terms_snapshot_markdown: '# Terms',
    });

    const adminToken = await signIn(anon, adminEmail, adminPassword);
    const adminClient = createClient(
      process.env.PLATFORM_TEST_SUPABASE_URL ||
        process.env.SUPABASE_URL ||
        process.env.EXPO_PUBLIC_SUPABASE_URL!,
      process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY!,
      {
        global: { headers: { Authorization: `Bearer ${adminToken}` } },
        auth: { persistSession: false, autoRefreshToken: false },
      },
    ) as DbClient;

    const { data: amendment, error: draftError } = await adminClient.rpc(
      'create_platform_account_amendment_draft',
      {
        p_account_id: account.id,
        p_account_name: `${namespace} Account`,
        p_monthly_retainer_cents: 300_000,
        p_agreement_type: 'platform_agreement',
      },
    );
    if (draftError) throw new Error(draftError.message);
    cleanup.amendmentIds.push(amendment.id);

    await adminClient.rpc('publish_platform_account_amendment', { p_amendment_id: amendment.id });

    const ownerToken = await signIn(anon, ownerEmail, ownerPassword);
    const ownerClient = createClient(
      process.env.PLATFORM_TEST_SUPABASE_URL ||
        process.env.SUPABASE_URL ||
        process.env.EXPO_PUBLIC_SUPABASE_URL!,
      process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY!,
      {
        global: { headers: { Authorization: `Bearer ${ownerToken}` } },
        auth: { persistSession: false, autoRefreshToken: false },
      },
    ) as DbClient;

    const { data: acceptResult, error: acceptError } = await ownerClient.rpc(
      'accept_platform_account_amendment',
      { p_amendment_id: amendment.id },
    );
    if (acceptError) throw new Error(acceptError.message);
    assert.equal(acceptResult.billing_change_kind, 'downgrade');
    assert.equal(acceptResult.requires_stripe_apply, true);

    const { data: billing } = await service
      .from('account_billing')
      .select('scheduled_monthly_retainer_cents, monthly_retainer_cents')
      .eq('account_id', account.id)
      .single();
    assert.equal(billing?.monthly_retainer_cents, 500_000);
    assert.equal(billing?.scheduled_monthly_retainer_cents, 300_000);
  } finally {
    for (const amendmentId of cleanup.amendmentIds) {
      await service.from('platform_account_amendment_revisions').delete().eq('amendment_id', amendmentId);
      await service.from('platform_account_amendments').delete().eq('id', amendmentId);
    }
    for (const accountId of cleanup.accountIds) {
      await service.from('account_billing_changes').delete().eq('account_id', accountId);
      await service.from('account_billing').delete().eq('account_id', accountId);
      await service.from('account_users').delete().eq('account_id', accountId);
      await service.from('accounts').delete().eq('id', accountId);
    }
    for (const userId of cleanup.userIds) {
      await service.from('user_access_flags').delete().eq('user_id', userId);
      await service.auth.admin.deleteUser(userId);
    }
  }
});

test('account amendment accept with downgrade to free schedules a zero retainer', async (t) => {
  const namespace = createPlatformTestNamespace('downgrade-free');
  const { service, anon } = getHarnessClients();
  const ownerEmail = `${namespace}-owner@furnace.test`;
  const adminEmail = `${namespace}-admin@furnace.test`;
  const ownerPassword = `Owner!${namespace.slice(-6)}Cc2`;
  const adminPassword = `Admin!${namespace.slice(-6)}Bb1`;
  const cleanup = {
    accountIds: [] as string[],
    amendmentIds: [] as string[],
    userIds: [] as string[],
  };

  try {
    if (!(await amendmentRpcsAvailable(service))) {
      t.skip('Account amendment RPCs are not present in the current test database.');
    }

    const { data: adminAuth } = await service.auth.admin.createUser({
      email: adminEmail,
      password: adminPassword,
      email_confirm: true,
    });
    if (!adminAuth.user) throw new Error('admin');
    cleanup.userIds.push(adminAuth.user.id);
    await waitForPublicUser(service, adminAuth.user.id);
    await service.from('user_access_flags').upsert({
      user_id: adminAuth.user.id,
      flag_key: 'platform_admin',
    });

    const { data: ownerAuth } = await service.auth.admin.createUser({
      email: ownerEmail,
      password: ownerPassword,
      email_confirm: true,
    });
    if (!ownerAuth.user) throw new Error('owner');
    cleanup.userIds.push(ownerAuth.user.id);
    await waitForPublicUser(service, ownerAuth.user.id);

    const { data: account } = await service
      .from('accounts')
      .insert({ name: `${namespace} Account` })
      .select('id')
      .single();
    if (!account) throw new Error('account');
    cleanup.accountIds.push(account.id);

    await service.from('account_users').insert({
      account_id: account.id,
      user_id: ownerAuth.user.id,
      is_owner: true,
      role: 'owner',
    });

    await service.from('account_billing').insert({
      account_id: account.id,
      monthly_retainer_cents: 500_000,
      billing_status: 'active',
      agreement_type: 'platform_agreement',
      proposal_snapshot_json: {},
      terms_version: 'platform-agreement-current',
      terms_snapshot_markdown: '# Terms',
      stripe_customer_id: `cus_${namespace}`,
      stripe_subscription_id: `sub_${namespace}`,
    });

    const adminToken = await signIn(anon, adminEmail, adminPassword);
    const adminClient = createClient(
      process.env.PLATFORM_TEST_SUPABASE_URL ||
        process.env.SUPABASE_URL ||
        process.env.EXPO_PUBLIC_SUPABASE_URL!,
      process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY!,
      {
        global: { headers: { Authorization: `Bearer ${adminToken}` } },
        auth: { persistSession: false, autoRefreshToken: false },
      },
    ) as DbClient;

    const { data: amendment, error: draftError } = await adminClient.rpc(
      'create_platform_account_amendment_draft',
      {
        p_account_id: account.id,
        p_account_name: `${namespace} Account`,
        p_monthly_retainer_cents: 0,
        p_agreement_type: 'platform_agreement',
      },
    );
    if (draftError) throw new Error(draftError.message);
    cleanup.amendmentIds.push(amendment.id);

    await adminClient.rpc('publish_platform_account_amendment', { p_amendment_id: amendment.id });

    const ownerToken = await signIn(anon, ownerEmail, ownerPassword);
    const ownerClient = createClient(
      process.env.PLATFORM_TEST_SUPABASE_URL ||
        process.env.SUPABASE_URL ||
        process.env.EXPO_PUBLIC_SUPABASE_URL!,
      process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY!,
      {
        global: { headers: { Authorization: `Bearer ${ownerToken}` } },
        auth: { persistSession: false, autoRefreshToken: false },
      },
    ) as DbClient;

    const { data: acceptResult, error: acceptError } = await ownerClient.rpc(
      'accept_platform_account_amendment',
      { p_amendment_id: amendment.id },
    );
    if (acceptError) throw new Error(acceptError.message);
    assert.equal(acceptResult.billing_change_kind, 'downgrade');
    assert.equal(acceptResult.requires_stripe_apply, true);
    assert.equal(acceptResult.scheduled_monthly_retainer_cents, 0);

    const { data: billing } = await service
      .from('account_billing')
      .select('scheduled_monthly_retainer_cents, monthly_retainer_cents')
      .eq('account_id', account.id)
      .single();
    assert.equal(billing?.monthly_retainer_cents, 500_000);
    assert.equal(billing?.scheduled_monthly_retainer_cents, 0);
  } finally {
    for (const amendmentId of cleanup.amendmentIds) {
      await service.from('platform_account_amendment_revisions').delete().eq('amendment_id', amendmentId);
      await service.from('platform_account_amendments').delete().eq('id', amendmentId);
    }
    for (const accountId of cleanup.accountIds) {
      await service.from('account_billing_changes').delete().eq('account_id', accountId);
      await service.from('account_billing').delete().eq('account_id', accountId);
      await service.from('account_users').delete().eq('account_id', accountId);
      await service.from('accounts').delete().eq('id', accountId);
    }
    for (const userId of cleanup.userIds) {
      await service.from('user_access_flags').delete().eq('user_id', userId);
      await service.auth.admin.deleteUser(userId);
    }
  }
});

test('account amendment upgrade stays pending until payment completion', async (t) => {
  const namespace = createPlatformTestNamespace('upgrade');
  const { service, anon } = getHarnessClients();
  const ownerEmail = `${namespace}-owner@furnace.test`;
  const adminEmail = `${namespace}-admin@furnace.test`;
  const ownerPassword = `Owner!${namespace.slice(-6)}Bb2`;
  const adminPassword = `Admin!${namespace.slice(-6)}Aa1`;
  const cleanup = {
    accountIds: [] as string[],
    amendmentIds: [] as string[],
    userIds: [] as string[],
  };

  try {
    if (!(await amendmentRpcsAvailable(service))) {
      t.skip('Account amendment RPCs are not present in the current test database.');
    }

    const { data: adminAuth } = await service.auth.admin.createUser({
      email: adminEmail,
      password: adminPassword,
      email_confirm: true,
    });
    if (!adminAuth.user) throw new Error('admin');
    cleanup.userIds.push(adminAuth.user.id);
    await waitForPublicUser(service, adminAuth.user.id);
    await service.from('user_access_flags').upsert({
      user_id: adminAuth.user.id,
      flag_key: 'platform_admin',
    });

    const { data: ownerAuth } = await service.auth.admin.createUser({
      email: ownerEmail,
      password: ownerPassword,
      email_confirm: true,
    });
    if (!ownerAuth.user) throw new Error('owner');
    cleanup.userIds.push(ownerAuth.user.id);
    await waitForPublicUser(service, ownerAuth.user.id);

    const { data: account, error: accountError } = await service
      .from('accounts')
      .insert({ name: `${namespace} Account` })
      .select('id')
      .single();
    if (accountError) throw new Error(accountError.message);
    cleanup.accountIds.push(account.id);

    const { error: billingError } = await service.from('account_billing').insert({
      account_id: account.id,
      monthly_retainer_cents: 500_000,
      billing_status: 'active',
      agreement_type: 'platform_agreement',
      proposal_snapshot_json: { plan_tier: 'silver' },
      terms_version: 'test-v1',
      terms_snapshot_markdown: '# Terms',
    });
    if (billingError) throw new Error(billingError.message);

    const { error: memberError } = await service.from('account_users').insert({
      account_id: account.id,
      user_id: ownerAuth.user.id,
      role: 'owner',
      is_owner: true,
    });
    if (memberError) throw new Error(memberError.message);

    const adminToken = await signIn(anon, adminEmail, adminPassword);
    const adminClient = createClient(
      process.env.PLATFORM_TEST_SUPABASE_URL ||
        process.env.SUPABASE_URL ||
        process.env.EXPO_PUBLIC_SUPABASE_URL!,
      process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY!,
      {
        global: { headers: { Authorization: `Bearer ${adminToken}` } },
        auth: { persistSession: false, autoRefreshToken: false },
      },
    ) as DbClient;

    const { data: amendment, error: draftError } = await adminClient.rpc(
      'create_platform_account_amendment_draft',
      {
        p_account_id: account.id,
        p_account_name: `${namespace} Account`,
        p_monthly_retainer_cents: 700_000,
        p_agreement_type: 'platform_agreement',
      },
    );
    if (draftError) throw new Error(draftError.message);
    cleanup.amendmentIds.push(amendment.id);

    const { error: publishError } = await adminClient.rpc('publish_platform_account_amendment', {
      p_amendment_id: amendment.id,
    });
    if (publishError) throw new Error(publishError.message);

    const ownerToken = await signIn(anon, ownerEmail, ownerPassword);
    const ownerClient = createClient(
      process.env.PLATFORM_TEST_SUPABASE_URL ||
        process.env.SUPABASE_URL ||
        process.env.EXPO_PUBLIC_SUPABASE_URL!,
      process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY!,
      {
        global: { headers: { Authorization: `Bearer ${ownerToken}` } },
        auth: { persistSession: false, autoRefreshToken: false },
      },
    ) as DbClient;

    const { data: acceptResult, error: acceptError } = await ownerClient.rpc(
      'accept_platform_account_amendment',
      { p_amendment_id: amendment.id },
    );
    if (acceptError) throw new Error(acceptError.message);
    assert.equal(acceptResult.status, 'pending_payment');
    assert.equal(acceptResult.billing_change_kind, 'upgrade');
    assert.equal(acceptResult.requires_stripe_apply, true);
    assert.equal(acceptResult.new_monthly_retainer_cents, 700_000);

    const { data: amendmentAfterAccept, error: amendmentAfterAcceptError } = await service
      .from('platform_account_amendments')
      .select('status, accepted_at, accepted_by_user_id')
      .eq('id', amendment.id)
      .single();
    if (amendmentAfterAcceptError) throw new Error(amendmentAfterAcceptError.message);
    assert.equal(amendmentAfterAccept.status, 'pending_payment');
    assert.equal(amendmentAfterAccept.accepted_at, null);
    assert.equal(amendmentAfterAccept.accepted_by_user_id, null);

    const { data: billingAfterAccept, error: billingAfterAcceptError } = await service
      .from('account_billing')
      .select('monthly_retainer_cents, accepted_amendment_id')
      .eq('account_id', account.id)
      .single();
    if (billingAfterAcceptError) throw new Error(billingAfterAcceptError.message);
    assert.equal(billingAfterAccept.monthly_retainer_cents, 500_000);
    assert.equal(billingAfterAccept.accepted_amendment_id, null);

    const { error: completeError } = await service.rpc('complete_account_amendment_upgrade', {
      p_amendment_id: amendment.id,
      p_new_monthly_retainer_cents: 700_000,
      p_pending_first_delta_coupon_cents: 0,
      p_upgrade_delta_invoice_id: 'in_test_upgrade_delta',
      p_accepted_by_user_id: ownerAuth.user.id,
    });
    if (completeError) throw new Error(completeError.message);

    const { data: amendmentAfterComplete, error: amendmentAfterCompleteError } = await service
      .from('platform_account_amendments')
      .select('status, accepted_at, accepted_by_user_id, accepted_revision_number')
      .eq('id', amendment.id)
      .single();
    if (amendmentAfterCompleteError) throw new Error(amendmentAfterCompleteError.message);
    assert.equal(amendmentAfterComplete.status, 'accepted');
    assert.equal(amendmentAfterComplete.accepted_by_user_id, ownerAuth.user.id);
    assert.equal(amendmentAfterComplete.accepted_revision_number, 1);
    assert.ok(amendmentAfterComplete.accepted_at);

    const { data: billingAfterComplete, error: billingAfterCompleteError } = await service
      .from('account_billing')
      .select('monthly_retainer_cents, accepted_amendment_id, upgrade_delta_invoice_id')
      .eq('account_id', account.id)
      .single();
    if (billingAfterCompleteError) throw new Error(billingAfterCompleteError.message);
    assert.equal(billingAfterComplete.monthly_retainer_cents, 700_000);
    assert.equal(billingAfterComplete.accepted_amendment_id, amendment.id);
    assert.equal(billingAfterComplete.upgrade_delta_invoice_id, 'in_test_upgrade_delta');

    const { data: changeRow, error: changeError } = await service
      .from('account_billing_changes')
      .select('change_kind, amendment_id, old_monthly_retainer_cents, new_monthly_retainer_cents')
      .eq('account_id', account.id)
      .eq('amendment_id', amendment.id)
      .eq('change_kind', 'upgrade')
      .single();
    if (changeError) throw new Error(changeError.message);
    assert.equal(changeRow.old_monthly_retainer_cents, 500_000);
    assert.equal(changeRow.new_monthly_retainer_cents, 700_000);
  } finally {
    for (const amendmentId of cleanup.amendmentIds) {
      await service.from('platform_account_amendment_revisions').delete().eq('amendment_id', amendmentId);
      await service.from('platform_account_amendments').delete().eq('id', amendmentId);
    }
    for (const accountId of cleanup.accountIds) {
      await service.from('account_billing_changes').delete().eq('account_id', accountId);
      await service.from('account_billing').delete().eq('account_id', accountId);
      await service.from('account_users').delete().eq('account_id', accountId);
      await service.from('accounts').delete().eq('id', accountId);
    }
    for (const userId of cleanup.userIds) {
      await service.from('user_access_flags').delete().eq('user_id', userId);
      await service.auth.admin.deleteUser(userId);
    }
  }
});

test('account amendment upgrade from free stays pending until payment completion', async (t) => {
  const namespace = createPlatformTestNamespace('upgrade-from-free');
  const { service, anon } = getHarnessClients();
  const ownerEmail = `${namespace}-owner@furnace.test`;
  const adminEmail = `${namespace}-admin@furnace.test`;
  const ownerPassword = `Owner!${namespace.slice(-6)}Dd2`;
  const adminPassword = `Admin!${namespace.slice(-6)}Cc1`;
  const cleanup = {
    accountIds: [] as string[],
    amendmentIds: [] as string[],
    userIds: [] as string[],
  };

  try {
    if (!(await amendmentRpcsAvailable(service))) {
      t.skip('Account amendment RPCs are not present in the current test database.');
    }

    const { data: adminAuth } = await service.auth.admin.createUser({
      email: adminEmail,
      password: adminPassword,
      email_confirm: true,
    });
    if (!adminAuth.user) throw new Error('admin');
    cleanup.userIds.push(adminAuth.user.id);
    await waitForPublicUser(service, adminAuth.user.id);
    await service.from('user_access_flags').upsert({
      user_id: adminAuth.user.id,
      flag_key: 'platform_admin',
    });

    const { data: ownerAuth } = await service.auth.admin.createUser({
      email: ownerEmail,
      password: ownerPassword,
      email_confirm: true,
    });
    if (!ownerAuth.user) throw new Error('owner');
    cleanup.userIds.push(ownerAuth.user.id);
    await waitForPublicUser(service, ownerAuth.user.id);

    const { data: account, error: accountError } = await service
      .from('accounts')
      .insert({ name: `${namespace} Account` })
      .select('id')
      .single();
    if (accountError) throw new Error(accountError.message);
    cleanup.accountIds.push(account.id);

    const { error: billingError } = await service.from('account_billing').insert({
      account_id: account.id,
      monthly_retainer_cents: 0,
      billing_status: 'active',
      agreement_type: 'platform_agreement',
      proposal_snapshot_json: { plan_tier: 'silver' },
      terms_version: 'test-v1',
      terms_snapshot_markdown: '# Terms',
      stripe_customer_id: `cus_${namespace}`,
    });
    if (billingError) throw new Error(billingError.message);

    const { error: memberError } = await service.from('account_users').insert({
      account_id: account.id,
      user_id: ownerAuth.user.id,
      role: 'owner',
      is_owner: true,
    });
    if (memberError) throw new Error(memberError.message);

    const adminToken = await signIn(anon, adminEmail, adminPassword);
    const adminClient = createClient(
      process.env.PLATFORM_TEST_SUPABASE_URL ||
        process.env.SUPABASE_URL ||
        process.env.EXPO_PUBLIC_SUPABASE_URL!,
      process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY!,
      {
        global: { headers: { Authorization: `Bearer ${adminToken}` } },
        auth: { persistSession: false, autoRefreshToken: false },
      },
    ) as DbClient;

    const { data: amendment, error: draftError } = await adminClient.rpc(
      'create_platform_account_amendment_draft',
      {
        p_account_id: account.id,
        p_account_name: `${namespace} Account`,
        p_monthly_retainer_cents: 700_000,
        p_agreement_type: 'platform_agreement',
      },
    );
    if (draftError) throw new Error(draftError.message);
    cleanup.amendmentIds.push(amendment.id);

    const { error: publishError } = await adminClient.rpc('publish_platform_account_amendment', {
      p_amendment_id: amendment.id,
    });
    if (publishError) throw new Error(publishError.message);

    const ownerToken = await signIn(anon, ownerEmail, ownerPassword);
    const ownerClient = createClient(
      process.env.PLATFORM_TEST_SUPABASE_URL ||
        process.env.SUPABASE_URL ||
        process.env.EXPO_PUBLIC_SUPABASE_URL!,
      process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY!,
      {
        global: { headers: { Authorization: `Bearer ${ownerToken}` } },
        auth: { persistSession: false, autoRefreshToken: false },
      },
    ) as DbClient;

    const { data: acceptResult, error: acceptError } = await ownerClient.rpc(
      'accept_platform_account_amendment',
      { p_amendment_id: amendment.id },
    );
    if (acceptError) throw new Error(acceptError.message);
    assert.equal(acceptResult.status, 'pending_payment');
    assert.equal(acceptResult.billing_change_kind, 'upgrade');
    assert.equal(acceptResult.requires_stripe_apply, true);
    assert.equal(acceptResult.old_monthly_retainer_cents, 0);
    assert.equal(acceptResult.new_monthly_retainer_cents, 700_000);

    const { data: billingAfterAccept, error: billingAfterAcceptError } = await service
      .from('account_billing')
      .select('monthly_retainer_cents, accepted_amendment_id, stripe_subscription_id')
      .eq('account_id', account.id)
      .single();
    if (billingAfterAcceptError) throw new Error(billingAfterAcceptError.message);
    assert.equal(billingAfterAccept.monthly_retainer_cents, 0);
    assert.equal(billingAfterAccept.accepted_amendment_id, null);
    assert.equal(billingAfterAccept.stripe_subscription_id, null);
  } finally {
    for (const amendmentId of cleanup.amendmentIds) {
      await service.from('platform_account_amendment_revisions').delete().eq('amendment_id', amendmentId);
      await service.from('platform_account_amendments').delete().eq('id', amendmentId);
    }
    for (const accountId of cleanup.accountIds) {
      await service.from('account_billing_changes').delete().eq('account_id', accountId);
      await service.from('account_billing').delete().eq('account_id', accountId);
      await service.from('account_users').delete().eq('account_id', accountId);
      await service.from('accounts').delete().eq('id', accountId);
    }
    for (const userId of cleanup.userIds) {
      await service.from('user_access_flags').delete().eq('user_id', userId);
      await service.auth.admin.deleteUser(userId);
    }
  }
});
