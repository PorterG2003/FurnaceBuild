import { supabase } from '../../client';

const DEFAULT_TITLE = 'Test: New email received';
const DEFAULT_BODY = 'This is a test in-app notification (test.notification).';

export async function createTestNotification(
  accountId: string,
  options?: { title?: string; body?: string }
): Promise<string> {
  const { data, error } = await supabase.rpc('create_test_notification', {
    p_account_id: accountId,
    p_payload: {
      title: options?.title ?? DEFAULT_TITLE,
      body: options?.body ?? DEFAULT_BODY,
    },
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error('create_test_notification returned no id');
  return data;
}
