export type { TransactionalEmail } from './types.js';
export { buildTeamInvitationEmail } from './teamInvitation.js';
export { buildPlatformInviteEmail } from './platformInvite.js';
export { buildAccountAmendmentEmail } from './accountAmendment.js';
export { buildFluxQuizSubmissionEmail, type FluxQuizAnswerRow } from './fluxQuizSubmission.js';
export {
  buildFurnaceEmailLogoHtml,
  FURNACE_EMAIL_LOGO_MAX_WIDTH_PX,
  FURNACE_EMAIL_LOGO_PATH,
  resolveFurnaceEmailAppOrigin,
  resolveFurnaceEmailLogoUrl,
} from '../brand.js';
export {
  buildConfirmSignupEmail,
  buildMagicLinkEmail,
  buildResetPasswordEmail,
  buildInviteUserEmail,
  buildChangeEmailEmail,
  buildReauthenticationEmail,
  buildPasswordChangedEmail,
  buildEmailAddressChangedEmail,
  buildSupabaseAuthTemplates,
  SUPABASE_AUTH_PLACEHOLDERS,
} from './auth/index.js';
