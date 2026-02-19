/**
 * Email utilities: body parsing (strip quoted replies, signatures, HTML).
 */
export {
  stripHtml,
  parseEmailBody,
  getDisplayBody,
  type ParseEmailBodyOptions,
  type ParsedEmailBody,
} from './parse-body';

export {
  sanitizeEmailBody,
  hasResidualEncodingArtifacts,
  type SanitizeEmailBodyOptions,
} from './sanitize-body';

export { mergeTemplate, extractVariableKeys, extractMalformedVariables, hasMissingValues, type LeadLike } from './mergeTemplate';
export { processSpintax, type ProcessSpintaxOptions } from './processSpintax';
export { getLeadVariables, type LeadVariable } from './leadVariables';
export {
  buildCampaignEmailContent,
  type BuildCampaignEmailContentConfig,
  type BuildCampaignEmailContentResult,
  type BuildCampaignEmailContentOptions,
} from './buildCampaignEmailContent';
