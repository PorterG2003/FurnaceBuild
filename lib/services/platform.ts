/** @deprecated Import from `@/lib/services/transactionalEmail` or `@/lib/services/platformCommerce` instead. */
export {
  sendTeamInvitationEmail,
  sendPlatformInviteEmail,
  sendPlatformAmendmentEmail,
} from './transactionalEmail';

export {
  ensurePlatformInviteAuthUser,
  getPlatformCheckoutQuote,
  createPlatformCheckoutSession,
  getInviteCheckoutStatus,
  reconcileInviteCheckoutStatus,
  getAccountUpgradeQuote,
  applyAccountUpgrade,
  createAccountUpgradeCheckoutSession,
  createAccountPaymentMethodUpdateSession,
  finalizeAccountPaymentMethodUpdate,
  scheduleAccountDowngrade,
  type PlatformCheckoutQuote,
  type InviteCheckoutStatus,
} from './platformCommerce';
