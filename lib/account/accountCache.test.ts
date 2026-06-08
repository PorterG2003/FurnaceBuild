import assert from 'node:assert';
import { after, beforeEach, describe, it } from 'node:test';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  clearAccountCache,
  loadPreferredAccountId,
  resolveBootstrapPreferredAccountId,
  savePreferredAccountId,
} from './accountCache';

type AsyncStorageLike = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

const PREFERRED_ACCOUNT_KEY = 'furnace:preferred-account-id';
const FULL_CACHE_KEY = 'furnace:account-cache';

const storage = new Map<string, string>();
const asyncStorage = AsyncStorage as AsyncStorageLike;
const originalGetItem = asyncStorage.getItem;
const originalSetItem = asyncStorage.setItem;
const originalRemoveItem = asyncStorage.removeItem;

beforeEach(() => {
  storage.clear();
  asyncStorage.getItem = async (key) => storage.get(key) ?? null;
  asyncStorage.setItem = async (key, value) => {
    storage.set(key, value);
  };
  asyncStorage.removeItem = async (key) => {
    storage.delete(key);
  };
});

after(() => {
  asyncStorage.getItem = originalGetItem;
  asyncStorage.setItem = originalSetItem;
  asyncStorage.removeItem = originalRemoveItem;
});

describe('preferred account persistence', () => {
  it('returns null when the key is missing or belongs to another user', async () => {
    assert.strictEqual(await loadPreferredAccountId('user-1'), null);

    storage.set(
      PREFERRED_ACCOUNT_KEY,
      JSON.stringify({
        userId: 'user-2',
        accountId: 'acct-2',
      }),
    );

    assert.strictEqual(await loadPreferredAccountId('user-1'), null);
  });

  it('round-trips a preferred account for the matching user', async () => {
    await savePreferredAccountId('user-1', 'acct-9');

    assert.strictEqual(await loadPreferredAccountId('user-1'), 'acct-9');
  });

  it('clears both the full cache key and preferred account key', async () => {
    storage.set(FULL_CACHE_KEY, '{"cached":true}');
    storage.set(
      PREFERRED_ACCOUNT_KEY,
      JSON.stringify({
        userId: 'user-1',
        accountId: 'acct-9',
      }),
    );

    await clearAccountCache();

    assert.strictEqual(storage.has(FULL_CACHE_KEY), false);
    assert.strictEqual(storage.has(PREFERRED_ACCOUNT_KEY), false);
  });
});

describe('resolveBootstrapPreferredAccountId', () => {
  it('prefers in-memory over persisted over cached values', () => {
    assert.strictEqual(
      resolveBootstrapPreferredAccountId('acct-in-memory', 'acct-persisted', 'acct-cached'),
      'acct-in-memory',
    );
    assert.strictEqual(
      resolveBootstrapPreferredAccountId(null, 'acct-persisted', 'acct-cached'),
      'acct-persisted',
    );
    assert.strictEqual(
      resolveBootstrapPreferredAccountId(null, null, 'acct-cached'),
      'acct-cached',
    );
    assert.strictEqual(resolveBootstrapPreferredAccountId(null, null, null), null);
  });
});
