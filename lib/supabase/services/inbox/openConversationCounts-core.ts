export async function loadOpenConversationCountsByAccountIds(
  accountIds: string[],
  fetchCount: (accountId: string) => Promise<number>,
): Promise<Record<string, number>> {
  if (accountIds.length === 0) return {};

  const entries = await Promise.all(
    accountIds.map(async (accountId) => {
      const count = await fetchCount(accountId);
      return [accountId, count] as const;
    }),
  );

  return Object.fromEntries(entries);
}

export const OPEN_CONVERSATION_COUNT_FILTERS = {
  conversationStatus: 'open',
  hasReply: true,
  countColumn: 'id',
} as const;
