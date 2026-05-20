import { supabase } from '@/lib/supabase/client';

const FAILED_DELIVERY_SELECT =
  'id, event_type, endpoint_url, status, response_status, error, created_at';

export type FailedWebhookDeliveryRow = {
  id: string;
  event_type: string;
  endpoint_url: string;
  status: string;
  response_status: number | null;
  error: string | null;
  created_at: string;
};

export async function fetchFailedWebhookDeliveries(
  accountId: string
): Promise<FailedWebhookDeliveryRow[]> {
  const { data, error } = await supabase
    .from('webhook_deliveries')
    .select(FAILED_DELIVERY_SELECT)
    .eq('account_id', accountId)
    .eq('status', 'failed')
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as FailedWebhookDeliveryRow[];
}

export async function countFailedWebhookDeliveries(accountId: string): Promise<number> {
  const { count, error } = await supabase
    .from('webhook_deliveries')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', accountId)
    .eq('status', 'failed');

  if (error) {
    throw new Error(error.message);
  }

  return count ?? 0;
}
