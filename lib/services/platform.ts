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
  getAccountUpgradeQuote,
  applyAccountUpgrade,
  createAccountPaymentMethodUpdateSession,
  finalizeAccountPaymentMethodUpdate,
  scheduleAccountDowngrade,
  type PlatformCheckoutQuote,
} from './platformCommerce';
