export async function getUserHasPlatformAdminAccess(userId: string): Promise<boolean> {
  const { getUserHasAccessFlag, ACCESS_FLAG_PLATFORM_ADMIN } = await import('../user-access-flags');
  return getUserHasAccessFlag(userId, ACCESS_FLAG_PLATFORM_ADMIN);
}
