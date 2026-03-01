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

export { mergeTemplate, extractVariableKeys, extractMalformedVariables, hasMissingValues, type LeadLike } from './mergeTemplate.js';
export { processSpintax, type ProcessSpintaxOptions } from './processSpintax.js';
export { getLeadVariables, type LeadVariable } from './leadVariables.js';
export { stripSignatureStyles } from './strip-signature-styles.js';
export {
  buildCampaignEmailContent,
  type BuildCampaignEmailContentConfig,
  type BuildCampaignEmailContentResult,
  type BuildCampaignEmailContentOptions,
} from './buildCampaignEmailContent.js';
