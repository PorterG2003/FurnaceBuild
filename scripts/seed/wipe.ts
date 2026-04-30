import type { SeedContext } from './types';

/**
 * Stub: validates wipe confirmation contract. FK-safe deletes by seed marker come later.
 * Future: for campaign-smoke, delete in dependency order (message_jobs → enrollments → leads →
 * campaign_mailboxes → mailboxes by seed email pattern → campaign by SEED_CAMPAIGN_ID / default UUID).
 */
export async function runWipe(ctx: SeedContext): Promise<void> {
  if (!ctx.wipe) return;

  if (ctx.dryRun) {
    ctx.log('[dry-run] wipe: would delete seed-tagged rows (not implemented)');
    return;
  }

  ctx.log('wipe: no rows deleted yet — implement FK-safe deletes by seed marker next');
}
