import type { Json } from '../../types/database';
import {
  deleteUserAccountSetting,
  getUserAccountPreferences,
  mergeUserAccountSettings,
} from '../accounts/userAccountPreferences';
import {
  parseInboxDefaultFilter,
  toInboxFilterSnapshot,
  type InboxDefaultFilterSnapshot,
} from './defaultFilterSnapshot';

export const INBOX_DEFAULT_FILTER_SETTING_KEY = 'inboxDefaultFilter';

export {
  parseInboxDefaultFilter,
  toInboxFilterSnapshot,
  inboxFiltersEqual,
  type InboxDefaultFilterSnapshot,
} from './defaultFilterSnapshot';

export async function getInboxDefaultFilter(
  accountId: string,
): Promise<InboxDefaultFilterSnapshot | null> {
  const settings = await getUserAccountPreferences(accountId);
  return parseInboxDefaultFilter(settings[INBOX_DEFAULT_FILTER_SETTING_KEY]);
}

export async function saveInboxDefaultFilter(
  accountId: string,
  snapshot: InboxDefaultFilterSnapshot,
): Promise<void> {
  await mergeUserAccountSettings(accountId, {
    [INBOX_DEFAULT_FILTER_SETTING_KEY]: toInboxFilterSnapshot(snapshot) as unknown as Json,
  });
}

export async function clearInboxDefaultFilter(accountId: string): Promise<void> {
  await deleteUserAccountSetting(accountId, INBOX_DEFAULT_FILTER_SETTING_KEY);
}
