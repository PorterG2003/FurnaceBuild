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
    throw new Error('Missing Supabase credentials for platform checkout attempt outcomes.');
  }
  return {
    supabaseUrl,
    publishableKey,
    service: createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    }) as DbClient,
    anon: createClient(supabaseUrl, publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    }) as DbClient,
  };
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

test('platform invite checkout attempt provisions through current session and stays idempotent', async (t) => {
  const namespace = createPlatformTestNamespace('checkout-attempt');
  const { service, anon, supabaseUrl, publishableKey } = getHarnessClients();
  const adminEmail = `${namespace}-admin@furnace.test`;
  const adminPassword = `Admin!${namespace.slice(-6)}Aa1`;
  const inviteeEmail = `${namespace}@example.com`;
  const inviteePassword = `Invitee!${namespace.slice(-6)}Bb1`;
  const cleanup = {
    userIds: [] as string[],
    invitationIds: [] as string[],
    accountIds: [] as string[],
    attemptIds: [] as string[],
  };

  t.after(async () => {
    if (cleanup.attemptIds.length) {
      await service.from('platform_invite_checkout_attempts').delete().in('id', cleanup.attemptIds);
    }
    if (cleanup.invitationIds.length) {
      await service.from('platform_invitation_revisions').delete().in('invitation_id', cleanup.invitationIds);
      await service.from('platform_invitations').delete().in('id', cleanup.invitationIds);
    }
    if (cleanup.accountIds.length) {
      await service.from('account_users').delete().in('account_id', cleanup.accountIds);
      await service.from('account_billing').delete().in('account_id', cleanup.accountIds);
      await service.from('accounts').delete().in('id', cleanup.accountIds);
    }
    for (const userId of cleanup.userIds) {
      await service.auth.admin.deleteUser(userId);
    }
  });

  const probe = await service.from('platform_invite_checkout_attempts').select('id').limit(1);
  if (
    probe.error &&
    (probe.error.message.includes('does not exist') || probe.error.code === 'PGRST205')
  ) {
    t.skip('platform_invite_checkout_attempts migration is not applied yet');
    return;
  }

  const { data: adminAuth, error: adminAuthError } = await service.auth.admin.createUser({
    email: adminEmail,
    password: adminPassword,
    email_confirm: true,
  });
  if (adminAuthError || !adminAuth.user) throw new Error(adminAuthError?.message ?? 'admin create failed');
  cleanup.userIds.push(adminAuth.user.id);
  await waitForPublicUser(service, adminAuth.user.id);
  const { error: flagError } = await service.from('user_access_flags').insert({
    user_id: adminAuth.user.id,
    flag_key: 'platform_admin',
  });
  assert.equal(flagError, null);

  const { data: inviteeAuth, error: inviteeAuthError } = await service.auth.admin.createUser({
    email: inviteeEmail,
    password: inviteePassword,
    email_confirm: true,
  });
  if (inviteeAuthError || !inviteeAuth.user) {
    throw new Error(inviteeAuthError?.message ?? 'invitee create failed');
  }
  cleanup.userIds.push(inviteeAuth.user.id);
  await waitForPublicUser(service, inviteeAuth.user.id);

  const adminToken = await signIn(anon, adminEmail, adminPassword);
  const adminClient = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${adminToken}` } },
  }) as DbClient;

  const { data: invitation, error: createError } = await adminClient.rpc('create_platform_invitation', {
    p_email: inviteeEmail,
    p_proposed_account_name: `${namespace} Co`,
    p_monthly_retainer_cents: 80000,
    p_currency: 'usd',
    p_proposal_snapshot_json: { proposal_title: 'Managed outreach' },
    p_terms_version: 'default-v1',
    p_agreement_type: 'platform_agreement',
    p_terms_source_markdown: '# Furnace Platform Agreement',
    p_auto_add_internal_admins: false,
    p_expires_at: null,
  });
  if (createError) throw new Error(createError.message);
  cleanup.invitationIds.push(invitation.id);

  const { error: publishError } = await adminClient.rpc('publish_platform_invitation', {
    p_invitation_id: invitation.id,
  });
  if (publishError) throw new Error(publishError.message);

  const inviteeToken = await signIn(anon, inviteeEmail, inviteePassword);
  const inviteeClient = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${inviteeToken}` } },
  }) as DbClient;

  const { error: prepareError } = await inviteeClient.rpc('prepare_platform_invitation_checkout', {
    p_invitation_id: invitation.id,
    p_full_name: 'Checkout Attempt Invitee',
    p_account_name: `${namespace} Co`,
    p_terms_accepted_ip: '127.0.0.1',
  });
  if (prepareError) throw new Error(prepareError.message);

  const sessionId = `cs_test_${namespace}`;
  const { data: attempt, error: attemptError } = await service
    .from('platform_invite_checkout_attempts')
    .insert({
      invitation_id: invitation.id,
      stripe_checkout_session_id: sessionId,
      stripe_payment_intent_id: `pi_test_${namespace}`,
      stripe_customer_id: `cus_test_${namespace}`,
      payment_route: 'ach',
      phase: 'processing',
    })
    .select('*')
    .single();
  if (attemptError) throw new Error(attemptError.message);
  cleanup.attemptIds.push(attempt.id);

  const { error: currentError } = await service
    .from('platform_invitations')
    .update({
      current_checkout_attempt_id: attempt.id,
      stripe_checkout_session_id: sessionId,
      selected_payment_route: 'ach',
      status: 'pending_payment',
    })
    .eq('id', invitation.id);
  if (currentError) throw new Error(currentError.message);

  const { data: completed, error: completeError } = await service.rpc('complete_platform_invitation', {
    p_invitation_id: invitation.id,
    p_stripe_customer_id: `cus_test_${namespace}`,
    p_stripe_subscription_id: `sub_test_${namespace}`,
    p_stripe_checkout_session_id: sessionId,
    p_internal_admin_emails: [] as string[],
  });
  if (completeError) throw new Error(completeError.message);
  assert.equal(completed.status, 'completed');
  cleanup.accountIds.push(completed.account_id);

  const { data: attemptAfter } = await service
    .from('platform_invite_checkout_attempts')
    .select('phase, provisioned_at')
    .eq('id', attempt.id)
    .single();
  assert.equal(attemptAfter?.phase, 'succeeded');
  assert.ok(attemptAfter?.provisioned_at);

  const { data: info } = await service.rpc('get_platform_invitation_info', {
    p_invitation_id: invitation.id,
  });
  assert.equal(info.status, 'active');
  assert.equal(info.checkout_phase, 'succeeded');
  assert.equal(info.checkout_session_id, sessionId);

  const { data: repeated, error: repeatedError } = await service.rpc('complete_platform_invitation', {
    p_invitation_id: invitation.id,
    p_stripe_customer_id: `cus_test_${namespace}`,
    p_stripe_subscription_id: `sub_test_${namespace}`,
    p_stripe_checkout_session_id: sessionId,
    p_internal_admin_emails: [] as string[],
  });
  if (repeatedError) throw new Error(repeatedError.message);
  assert.equal(repeated.status, 'already_completed');
  assert.equal(repeated.account_id, completed.account_id);
});
