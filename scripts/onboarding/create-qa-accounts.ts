/**
 * Creates (or updates) onboarding QA accounts on dev/staging Supabase.
 *
 * Usage:
 *   npx tsx scripts/onboarding/create-qa-accounts.ts
 *   npx tsx scripts/onboarding/create-qa-accounts.ts --reset-onboarding
 *
 * Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.local
 */

import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { loadSeedEnv, getSupabaseUrl } from '../seed/env';

loadSeedEnv();

const PASSWORD = 'OnboardingQA!2026Aa';

type AgreementType = 'platform_agreement' | 'managed_services_agreement';

interface PersonaSpec {
  label: string;
  ownerEmail: string;
  memberEmail: string;
  accountName: string;
  agreementType: AgreementType;
}

const PERSONAS: PersonaSpec[] = [
  {
    label: 'self-serve',
    ownerEmail: 'onboarding-qa-self-serve-owner@furnace.test',
    memberEmail: 'onboarding-qa-self-serve-member@furnace.test',
    accountName: 'Onboarding QA — Self-Serve',
    agreementType: 'platform_agreement',
  },
  {
    label: 'dfy',
    ownerEmail: 'onboarding-qa-dfy-owner@furnace.test',
    memberEmail: 'onboarding-qa-dfy-member@furnace.test',
    accountName: 'Onboarding QA — DFY',
    agreementType: 'managed_services_agreement',
  },
];

function randomId() {
  return crypto.randomUUID();
}

async function waitForPublicUser(service: ReturnType<typeof createClient>, userId: string) {
  for (let i = 0; i < 15; i += 1) {
    const { data } = await service.from('users').select('id').eq('id', userId).maybeSingle();
    if (data) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Timed out waiting for public.users row ${userId}`);
}

async function ensureAuthUser(
  service: ReturnType<typeof createClient>,
  email: string,
  name: string,
): Promise<string> {
  const { data: list } = await service.auth.admin.listUsers();
  const existing = list.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (existing) {
    await service.auth.admin.updateUserById(existing.id, {
      password: PASSWORD,
      email_confirm: true,
    });
    await waitForPublicUser(service, existing.id);
    await service.from('users').upsert({
      id: existing.id,
      external_id: existing.id,
      email,
      name,
      updated_at: new Date().toISOString(),
    });
    return existing.id;
  }

  const { data, error } = await service.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { name },
  });
  if (error || !data.user) throw new Error(error?.message ?? `Failed to create ${email}`);
  await waitForPublicUser(service, data.user.id);
  return data.user.id;
}

async function ensurePersona(
  service: ReturnType<typeof createClient>,
  spec: PersonaSpec,
): Promise<{ accountId: string; ownerId: string; memberId: string }> {
  const now = new Date().toISOString();
  const ownerId = await ensureAuthUser(service, spec.ownerEmail, `${spec.label} owner`);
  const memberId = await ensureAuthUser(service, spec.memberEmail, `${spec.label} member`);

  const { data: existingMembership } = await service
    .from('account_users')
    .select('account_id')
    .eq('user_id', ownerId)
    .eq('is_owner', true)
    .maybeSingle();

  let accountId = existingMembership?.account_id;

  if (!accountId) {
    accountId = randomId();
    const { error: accountError } = await service.from('accounts').insert({
      id: accountId,
      name: spec.accountName,
      created_at: now,
      updated_at: now,
    });
    if (accountError) throw new Error(accountError.message);
  } else {
    await service.from('accounts').update({ name: spec.accountName, updated_at: now }).eq('id', accountId);
  }

  const { data: ownerMembership } = await service
    .from('account_users')
    .select('id')
    .eq('account_id', accountId)
    .eq('user_id', ownerId)
    .maybeSingle();

  if (!ownerMembership) {
    const { error } = await service.from('account_users').insert({
      id: randomId(),
      account_id: accountId,
      user_id: ownerId,
      is_owner: true,
      role: 'owner',
      created_at: now,
      updated_at: now,
    });
    if (error) throw new Error(error.message);
  }

  const { data: memberMembership } = await service
    .from('account_users')
    .select('id')
    .eq('account_id', accountId)
    .eq('user_id', memberId)
    .maybeSingle();

  if (!memberMembership) {
    const { error } = await service.from('account_users').insert({
      id: randomId(),
      account_id: accountId,
      user_id: memberId,
      is_owner: false,
      role: 'member',
      created_at: now,
      updated_at: now,
    });
    if (error) throw new Error(error.message);
  }

  const { error: billingError } = await service.from('account_billing').upsert(
    {
      account_id: accountId,
      monthly_retainer_cents: 180000,
      billing_status: 'active',
      billing_anchor_day: 1,
      agreement_type: spec.agreementType,
      stripe_customer_id: `cus_onboarding_qa_${spec.label}`,
      stripe_subscription_id: `sub_onboarding_qa_${spec.label}`,
      updated_at: now,
    },
    { onConflict: 'account_id' },
  );
  if (billingError) throw new Error(billingError.message);

  return { accountId, ownerId, memberId };
}

async function resetOnboardingForEmails(service: ReturnType<typeof createClient>, emails: string[]) {
  for (const email of emails) {
    const { data: user } = await service.from('users').select('id').eq('email', email).maybeSingle();
    if (!user) continue;
    await service.from('user_onboarding_state').delete().eq('user_id', user.id);
  }
}

async function main() {
  const url = getSupabaseUrl();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const resetOnboarding = process.argv.includes('--reset-onboarding');
  const service = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const results: Array<{
    label: string;
    accountId: string;
    ownerId: string;
    ownerEmail: string;
    memberEmail: string;
  }> = [];

  for (const spec of PERSONAS) {
    const { accountId, ownerId, memberId } = await ensurePersona(service, spec);
    results.push({
      label: spec.label,
      accountId,
      ownerId,
      memberEmail: spec.memberEmail,
      ownerEmail: spec.ownerEmail,
    });
    console.log(`✓ ${spec.label}: account ${accountId}`);
  }

  const allEmails = PERSONAS.flatMap((p) => [p.ownerEmail, p.memberEmail]);
  if (resetOnboarding) {
    await resetOnboardingForEmails(service, allEmails);
    console.log('✓ Cleared user_onboarding_state for all QA users');
  }

  console.log('\n--- Onboarding QA accounts ---');
  console.log(`Password (all): ${PASSWORD}`);
  console.log(`App: http://localhost:8081\n`);
  for (const r of results) {
    console.log(`[${r.label}]`);
    console.log(`  account_id: ${r.accountId}`);
    console.log(`  owner_id:   ${r.ownerId}`);
    console.log(`  owner:  ${r.ownerEmail}`);
    console.log(`  member: ${r.memberEmail}`);
    console.log('');
  }

  const dfy = results.find((r) => r.label === 'dfy');
  if (dfy) {
    console.log('Seed demo-hub on DFY account:');
    console.log(`  SEED_ACCOUNT_ID=${dfy.accountId} \\`);
    console.log(`  SEED_OWNER_USER_ID=${dfy.ownerId} \\`);
    console.log('  npm run seed:demo');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
