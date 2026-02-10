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
