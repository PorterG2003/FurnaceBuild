/**
 * Email utilities: body parsing (strip quoted replies, signatures, HTML).
 */
export {
  stripHtml,
  parseEmailBody,
  getDisplayBody,
  type ParseEmailBodyOptions,
  type ParsedEmailBody,
} from './parse-body.js';

export {
  sanitizeEmailBody,
  hasResidualEncodingArtifacts,
  type SanitizeEmailBodyOptions,
} from './sanitize-body.js';
export {
  normalizeEmailHtmlForDarkMode,
  MAILBOX_RENDER_BACKGROUND,
  MAILBOX_RENDER_TEXT_COLOR,
  MAILBOX_RENDER_LINK_COLOR,
} from './normalize-render-html.js';

export { mergeTemplate, extractVariableKeys, extractMalformedVariables, hasMissingValues, type LeadLike } from './mergeTemplate.js';
export { processSpintax, type ProcessSpintaxOptions } from './processSpintax.js';
export { getLeadVariables, type LeadVariable } from './leadVariables.js';
export { stripSignatureStyles } from './strip-signature-styles.js';
export {
  buildCampaignEmailContent,
  htmlToFragment,
  mergeInboxComposeHtml,
  type BuildCampaignEmailContentConfig,
  type BuildCampaignEmailContentResult,
  type BuildCampaignEmailContentOptions,
  type MergeInboxComposeHtmlResult,
} from './buildCampaignEmailContent.js';

export {
  generateEmailVariantId,
  labelForVariantIndex,
  normalizeLegacyEmailNodeData,
  sortVariantsForRoundRobin,
  activeVariantsSorted,
  LEGACY_EMAIL_VARIANT_ID,
  type EmailNodeVariant,
} from './emailNodeVariants.js';
