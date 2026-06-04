import { supabase } from '../../client';
import type { AccountBilling, BillingAdjustment } from '../../types';
import type { PlatformPaymentRoute } from '@/lib/billing/paymentRoutes';
import { rpc } from './rpc';
import type { AdminUpdateAccountBillingResult, PlatformAccountBillingRow } from './types';

export async function getAccountBilling(accountId: string): Promise<AccountBilling | null> {
  const { data, error } = await supabase
    .from('account_billing')
    .select('*')
    .eq('account_id', accountId)
    .maybeSingle();
  if (error) throw new Error(`Failed to fetch account billing: ${error.message}`);
  return data as AccountBilling | null;
}

export async function listPlatformAccountBilling(): Promise<PlatformAccountBillingRow[]> {
  const { data, error } = await rpc('list_platform_account_billing');
  if (error) throw new Error(error.message);
  return (data ?? []) as PlatformAccountBillingRow[];
}

export async function createBillingAdjustment(params: {
  accountId: string;
  billingYear: number;
  billingMonth: number;
  discountCents: number;
  reason: string;
}): Promise<BillingAdjustment> {
  const { data, error } = await rpc('create_billing_adjustment', {
    p_account_id: params.accountId,
    p_billing_year: params.billingYear,
    p_billing_month: params.billingMonth,
    p_discount_cents: params.discountCents,
    p_reason: params.reason,
  });
  if (error) throw new Error(error.message);
  return data as BillingAdjustment;
}

export async function listBillingAdjustments(accountId?: string | null): Promise<BillingAdjustment[]> {
  const { data, error } = await rpc('list_billing_adjustments', {
    p_account_id: accountId ?? null,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as BillingAdjustment[];
}

export async function adminUpdateAccountBilling(params: {
  accountId: string;
  monthlyRetainerCents: number;
  preferredPaymentRoute?: PlatformPaymentRoute | null;
}): Promise<AdminUpdateAccountBillingResult> {
  const { data, error } = await rpc('admin_update_account_billing', {
    p_account_id: params.accountId,
    p_monthly_retainer_cents: params.monthlyRetainerCents,
    p_preferred_payment_route: params.preferredPaymentRoute ?? null,
  });
  if (error) throw new Error(error.message);
  return data as AdminUpdateAccountBillingResult;
}
